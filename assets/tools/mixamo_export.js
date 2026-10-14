// تصدير شخصيات وحركات من Mixamo (لازم تكون مسجّل دخول في mixamo.com).
// بيتشغّل جوه صفحة mixamo.com (من الـ console أو من Claude)، وبيرجّع روابط تنزيل مؤقتة (5 دقايق) تتنزل بـ curl.
// ملاحظات من التجربة:
// - الموقع بيصدّر حاجة واحدة في نفس الوقت: لازم بالترتيب، مش بالتوازي.
// - الحركات بتتصدّر من غير جلد (skin:false) على شخصية Aj، وبتتحوّل لأي شخصية تانية بـ reference/lib/mixamo.js.
// - المشي يتصدّر "في مكانه" (inplace) علشان إحنا اللي بنحرّك الشخصية في المشهد.

const H = () => ({ Authorization: "Bearer " + localStorage.getItem("access_token"), "X-Api-Key": "mixamo2", "Content-Type": "application/json" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function listCharacters() {
  return (await (await fetch("https://www.mixamo.com/api/v1/products?page=1&limit=200&type=Character", { headers: H() })).json()).results;
}

export async function searchMotions(query, limit = 8) {
  const d = await (await fetch(`https://www.mixamo.com/api/v1/products?page=1&limit=${limit}&type=Motion&query=${encodeURIComponent(query)}`, { headers: H() })).json();
  return d.results.map((x) => ({ name: x.name, description: x.description, id: x.id }));
}

/** بيصدّر حاجة واحدة ويستنى لحد ما تجهز. kind: "char" (T-pose بالجلد) أو "anim" (حركة من غير جلد) */
export async function exportOne({ characterId, name, kind = "char", animId = null, inplace = false }) {
  let body;
  if (kind === "char") {
    body = { character_id: characterId, product_name: name, type: "Character", preferences: { format: "fbx7_2019", mesh_type: "t-pose" }, gms_hash: null };
  } else {
    const p = await (await fetch(`https://www.mixamo.com/api/v1/products/${animId}?similar=0&character_id=${characterId}`, { headers: H() })).json();
    const g = p.details.gms_hash;
    const gms = { ...g, params: (g.params || []).map((x) => x[1]).join(","), inplace: inplace && g.inplace !== undefined ? true : g.inplace };
    body = { character_id: characterId, gms_hash: [gms], preferences: { format: "fbx7_2019", skin: "false", fps: "30", reducekf: "0" }, product_name: name, type: "Motion" };
  }
  const ex = await fetch("https://www.mixamo.com/api/v1/animations/export", { method: "POST", headers: H(), body: JSON.stringify(body) });
  if (ex.status >= 300) throw new Error(`export ${ex.status}`);
  for (let i = 0; i < 40; i++) {
    await sleep(2200);
    const m = await (await fetch(`https://www.mixamo.com/api/v1/characters/${characterId}/monitor`, { headers: H() })).json();
    if (m.status === "completed") return m.job_result; // رابط S3 صالح 5 دقايق
    if (m.status === "failed") throw new Error("failed");
  }
  throw new Error("timeout");
}
