# بينزّل شخصيات Microsoft Rocketbox (MIT) المختارة: النسخة اللي فيها الوش (_facial.fbx) + الصور اللازمة،
# وبيصغّر الصور من TGA 2048 لـ PNG 1024، وبيمسح الملفات الكبيرة بعدها.
import json, os, subprocess, sys, urllib.request
ROOT = sys.argv[1]
API = "https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents/Assets/Avatars/"
RAW = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars/"
CHARS = ["Professions/Business_Male_01", "Professions/Business_Male_02", "Professions/Business_Male_03", "Professions/Business_Male_04",
         "Professions/Business_Male_05", "Professions/Business_Female_01", "Professions/Business_Female_02", "Professions/Business_Female_03",
         "Professions/Business_Female_04", "Professions/Medical_Male_01", "Professions/Medical_Female_01",
         "Adults/Male_Adult_03", "Adults/Male_Adult_08", "Adults/Male_Adult_14", "Adults/Male_Adult_19", "Adults/Male_Adult_21",
         "Adults/Female_Adult_02", "Adults/Female_Adult_06", "Adults/Female_Adult_09", "Adults/Female_Adult_14"]
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tiktok-motion"})
    return urllib.request.urlopen(req, timeout=300).read()
for c in CHARS:
    name = c.split("/")[1]; out = os.path.join(ROOT, name)
    if os.path.exists(os.path.join(out, "done")):
        continue
    os.makedirs(out, exist_ok=True)
    fbx = f"{name}_facial.fbx"
    open(os.path.join(out, fbx), "wb").write(get(f"{RAW}{c}/Export/{fbx}"))
    texs = [t["name"] for t in json.loads(get(f"{API}{c}/Textures")) if t["name"].lower().endswith(".tga") and "specular" not in t["name"].lower()]
    for t in texs:
        tmp = os.path.join(out, "_" + t)
        open(tmp, "wb").write(get(f"{RAW}{c}/Textures/{t}"))
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp, "-vf", "scale=1024:1024", os.path.join(out, t[:-4] + ".png")], check=True)
        os.remove(tmp)
    open(os.path.join(out, "done"), "w").write("ok")
    print("✓", name, texs, flush=True)
print("ALL DONE")
