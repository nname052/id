// أدوات مشتركة للصفحات
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.detail) || `HTTP ${r.status}`);
  return data;
}

const STAGE_NAMES = { script: "① السكريبت", tts: "② الإحساس والنطق", brief: "③ الرؤية الإخراجية", scenes: "④ المشاهد", audio: "⑤ الصوت", render: "⑥ التصدير" };
const STATUS_NAMES = { pending: "", queued: "في الطابور", running: "شغال", review: "مستني موافقتك", approved: "✓", failed: "فشل",
  stale: "محتاج يتعاد", waiting_limit: "واقف (حد الاستخدام)", needs_credits: "محتاج موافقة", needs_voice: "مستني صوتك" };
const fmtDate = (s) => new Date(s).toLocaleDateString("ar-EG", { day: "numeric", month: "long" });

// الصفحة الحالية في الشريط اللي فوق
for (const a of document.querySelectorAll("header.top nav a.btn:not(.primary)")) {
  const h = a.getAttribute("href");
  if (location.pathname === h || location.pathname.startsWith(h + "/")) a.classList.add("here");
}
