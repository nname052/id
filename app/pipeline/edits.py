"""تعديل جزء من الفيديو من غير ما يتعمل من الأول: كلمة في السكريبت، أو نص النطق لجملة، أو مشهد واحد.
كل تعديل بيلمس الجزء بتاعه بس (التجهيز للنطق، والصوت، والمشاهد)، وفي الآخر التصدير بس هو اللي محتاج يتعاد."""

from .. import store
from . import audio, scenes, tts_prep
from . import tags as tagrules
from .common import words_of


def script(pid: str, sentences: list[dict]) -> dict:
    """sentences = [{id (أو None لجملة جديدة), text}] بالترتيب الجديد. بيرجّع ملخص اللي اتغيّر."""
    d = store.project_dir(pid)
    old = store.read_json(d / "script.json")
    old_by = {s["id"]: s["text"] for s in old["sentences"]}
    next_id = max(old_by, default=-1) + 1
    new, changed, added = [], [], []
    for s in sentences:
        text = " ".join(str(s.get("text", "")).split())
        if not text:
            continue
        sid = s.get("id")
        if sid is None or sid not in old_by:
            sid, next_id = next_id, next_id + 1
            added.append(sid)
        elif old_by[sid] != text:
            changed.append(sid)
        new.append({"id": sid, "text": text})
    removed = [i for i in old_by if i not in {s["id"] for s in new}]
    if not new:
        raise ValueError("السكريبت فاضي")
    store.write_json(d / "script.json", {**old, "sentences": new})
    summary = {"changed": changed, "added": added, "removed": removed}
    if not (changed or added or removed):
        return summary
    store.log(pid, f"✎ تعديل السكريبت: اتغيّر {changed}، اتضاف {added}، اتشال {removed}")

    # 1) التجهيز للنطق: الجمل اللي اتغيّرت أو اتضافت بس (والباقي زي ما هو)
    if (d / "tts.json").exists():
        tts_prep.run(pid, only=changed + added)
        t = store.read_json(d / "tts.json")
        t["lines"] = [l for l in t["lines"] if l["id"] not in removed]
        order = {s["id"]: i for i, s in enumerate(new)}
        t["lines"].sort(key=lambda l: order[l["id"]])
        store.write_json(d / "tts.json", t)

    # 2) المشاهد: الجملة اللي اتشالت بتطلع من مشهدها، والجديدة بتنضم لمشهد الجملة اللي قبلها
    plan = store.read_json(d / "scenes" / "plan.json")
    if plan:
        ids = [s["id"] for s in new]
        for sc in plan["scenes"]:
            sc["sentence_ids"] = [i for i in sc["sentence_ids"] if i not in removed]
        for sid in added:
            prev = ids[ids.index(sid) - 1] if ids.index(sid) > 0 else None
            host = next((sc for sc in plan["scenes"] if prev in sc["sentence_ids"]), plan["scenes"][0])
            host["sentence_ids"].append(sid)
            host["sentence_ids"].sort(key=ids.index)
        plan["scenes"] = [sc for sc in plan["scenes"] if sc["sentence_ids"]]
        store.write_json(d / "scenes" / "plan.json", plan)

    # 3) الصوت: بنشيل ونعيد ونضيف الجمل دي بس جوه الصوت الكامل
    if (d / "audio" / "voice.mp3").exists() and (d / "words.json").exists():
        for sid in removed:
            audio.remove_sentence(pid, sid)
        for sid in changed:
            audio.regen_sentence(pid, sid)
        for sid in added:
            audio.regen_sentence(pid, sid, insert=True)
    return summary


def tts_lines(pid: str, lines: list[dict]) -> list[int]:
    """نص النطق اتعدّل بإيدك (tags، ترقيم، طريقة نطق كلمة). الكلمات لازم تفضل بنفس العدد علشان الترجمة."""
    d = store.project_dir(pid)
    t = store.read_json(d / "tts.json")
    by = {l["id"]: l for l in t["lines"]}
    changed = []
    for x in lines:
        cur = by.get(x["id"])
        txt = " ".join(str(x.get("tts", "")).split())
        if not cur or not txt or txt == cur["tts"]:
            continue
        if len(words_of(txt)) != len(cur["display"].split()):
            raise ValueError(f"الجملة {x['id'] + 1}: عدد الكلمات لازم يفضل {len(cur['display'].split())} (الـ tags مش بتتحسب)")
        bad = [t for t in tagrules.tags_of(txt) if t not in tagrules.ALLOWED]
        if bad:   # الإحساس نفسه اختيارك، بس الـ tag لازم يكون من القايمة اللي ElevenLabs موثّقها
            raise ValueError(f"الجملة {x['id'] + 1}: tag مش معروف {', '.join('[' + b + ']' for b in bad)}. المسموح: "
                             + " ".join(f"[{a}]" for a in sorted(tagrules.ALLOWED)))
        cur["tts"] = txt
        changed.append(x["id"])
    store.write_json(d / "tts.json", t)
    if changed and (d / "audio" / "voice.mp3").exists() and (d / "words.json").exists():
        for sid in changed:
            audio.regen_sentence(pid, sid)
    return changed


def scene(pid: str, scene_id: str, instruction: str) -> None:
    scenes.edit_scene(pid, scene_id, instruction)
