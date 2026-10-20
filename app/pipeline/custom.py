"""المشاهد المبتكرة: Claude بيكتب كود مشهد كامل (JS) لفكرة بصرية مش موجودة في الأشكال الجاهزة.
الكود بيتفحص (ممنوع الوقت الحقيقي والعشوائي والروابط الخارجية)، ولو فشل المشهد بيرجع لشكل جاهز."""

import re

from .. import store
from .common import ask

BANNED = [r"Math\.random", r"Date\b", r"performance\.now", r"requestAnimationFrame", r"setTimeout", r"setInterval",
          r"https?://", r"\bfetch\(", r"XMLHttpRequest", r"import\(", r"\beval\(", r"new Function", r"transition\s*:", r"animation\s*:"]

SYSTEM = """إنت مصمم موشن جرافيك محترف بتكتب مشهد واحد لفيديو تيك توك عربي (1080×1920) بالكود. المشهد لازم يبقى مبهر وأنيق، مش زحمة.

اكتب ES module بالشكل ده بالظبط:
```js
export default {
  setup(root, kit) {
    // ابني كل العناصر هنا مرة واحدة جوه root (div بمقاس 1080×1920، position: absolute).
    // استخدم HTML للكلام العربي (dir=rtl) و SVG للأشكال.
  },
  renderAt(t, ctx) {
    // t = الوقت بالثواني من بداية المشهد. ctx.duration = طول المشهد. ctx.cue("كلمة") = وقت الكلمة دي جوه المشهد.
    // لازم تكون دالة نقية: نفس t ← نفس الشكل بالظبط. غيّر الـ style والـ attributes بس.
  }
}
```

kit فيه: kit.ease(x), kit.easeOut(x), kit.easeInOut(x), kit.back(x), kit.clamp(x,a,b), kit.lerp(a,b,p), kit.rand(seed) ← دالة أرقام ثابتة,
kit.palette = {bg, ink, accent, accent2, surface}, kit.fonts = {heading, body}, kit.svg(tag, attrs) ← بيعمل عنصر SVG.

قواعد إجبارية:
- ممنوع: Math.random، Date، performance.now، requestAnimationFrame، setTimeout، setInterval، fetch، أي رابط http، CSS transition أو animation.
- الحركة كلها محسوبة من t. لو محتاج عشوائي استخدم kit.rand(رقم ثابت).
- الكلام المهم جوه المنطقة الآمنة: y من 200 لـ 1300 (تحت 1330 فيه الترجمة، ومتسيبش حاجة مهمة هناك)، و x من 60 لـ 1000.
- أصغر خط 56px، والعناوين بخط kit.fonts.heading وبوزن 700 أو 800. الكلام عربي من الجملة نفسها.
- خلفية المشهد شفافة (الخلفية العامة موجودة). ممكن تضيف أشكال جوه المشهد.
- استخدم ألوان kit.palette بس.
- خلّي الحركة سلسة: دخول في أول 0.6 ثانية، وحاجة بتتحرك بهدوء بعدها، وما تخليش المشهد ثابت.
- اتأكد إن كل الحسابات بترجع أرقام سليمة في أي لحظة (t = 0 ولحد آخر المشهد): ممنوع NaN أو undefined أو قسمة على صفر.
  ctx.cue() ممكن ترجع 0، و ctx.duration ممكن يبقى قصير (ثانيتين). استخدم kit.clamp.
- الكود لوحده من غير أي شرح، ومن غير ```."""

SCHEMA = {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"], "additionalProperties": False}


def check(code: str) -> str | None:
    """بيرجّع سبب الرفض (أو None لو الكود سليم)."""
    for pat in BANNED:
        if re.search(pat, code):
            return f"فيه حاجة ممنوعة: {pat}"
    if "export default" not in code or "renderAt" not in code or "setup" not in code:
        return "الكود مش بالشكل المطلوب"
    return None


def make(pid: str, sc: dict, plan: dict, script: dict) -> bool:
    d = store.project_dir(pid)
    text = " ".join(s["text"] for s in script["sentences"] if s["id"] in sc["sentence_ids"])
    ident = plan["identity"]
    user = (f"الجملة اللي بتتقال في المشهد: {text}\nالعنوان المقترح: {sc.get('headline')}\nفكرة المشهد: {sc.get('custom_brief')}\n"
            f"الألوان: {ident['palette']}\nخط العناوين: {ident['font_heading']}، خط الكلام: {ident['font_body']}\n"
            f"إيقاع الحركة: {plan.get('pace')}")
    last_error = None
    for attempt in range(2):
        u = user + (f"\n\nالمحاولة اللي فاتت اترفضت: {last_error}. صلّحها." if last_error else "")
        try:
            code = ask(pid, "scenes", SYSTEM, u, SCHEMA)["code"]
        except Exception as e:  # noqa: BLE001
            last_error = str(e)[:200]
            continue
        code = re.sub(r"^```\w*\n|```$", "", code.strip())
        last_error = check(code)
        if not last_error:
            path = d / "scenes" / f"custom_{sc['id']}.js"
            path.write_text(code, encoding="utf-8")
            sc["custom_file"] = path.name
            return True
    store.log(pid, f"✗ المشهد المبتكر {sc['id']} اتلغى: {last_error}")
    return False
