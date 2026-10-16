// وش الشخصيات الواقعية (Rocketbox): 15 شكل بق للحروف (visemes) + تعبيرات (ARKit) + رمش طبيعي.
// البق بيتحسب من توقيت الكلمات (بعد ما الصوت يتعمل، أو بعد ما صوتك يتظبط عليه)، والتعبير من وضعية الأداء.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => (x = clamp(x), x * x * (3 - 2 * x));

// الحرف ← شكل البق (Oculus visemes)
const VIS = ["Sil", "PP", "FF", "TH", "DD", "KK", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"];
function visemeOf(c, msa) {
  if ("بم".includes(c)) return "PP";
  if ("ف".includes(c)) return "FF";
  if ("ثذظ".includes(c)) return "TH";
  if ("تدطض".includes(c)) return "DD";
  if ("نل".includes(c)) return "nn";
  if ("كقغخ".includes(c)) return "KK";
  if (c === "ج") return msa ? "CH" : "KK"; // الجيم المصري "g"
  if ("شچ".includes(c)) return "CH";
  if ("سصز".includes(c)) return "SS";
  if (c === "ر") return "RR";
  if ("اأإآىةَعحهء".includes(c)) return "aa";
  if ("يِ".includes(c)) return "I";
  if ("وُ".includes(c)) return "U";
  if (/[a-z]/i.test(c)) return "aa";
  return null;
}
// التعبيرات: أوزان أشكال الوش (أسماء ARKit)
const EXPR = {
  neutral: {},
  smile: { MouthSmileLeft: 0.45, MouthSmileRight: 0.45, CheekSquintLeft: 0.2, CheekSquintRight: 0.2 },
  big_smile: { MouthSmileLeft: 0.8, MouthSmileRight: 0.8, CheekSquintLeft: 0.45, CheekSquintRight: 0.45, EyeSquintLeft: 0.25, EyeSquintRight: 0.25 },
  warm: { MouthSmileLeft: 0.28, MouthSmileRight: 0.28, BrowInnerUp: 0.15 },
  serious: { BrowDownLeft: 0.25, BrowDownRight: 0.25, MouthPressLeft: 0.2, MouthPressRight: 0.2 },
  sad: { MouthFrownLeft: 0.55, MouthFrownRight: 0.55, BrowInnerUp: 0.6, MouthShrugLower: 0.2 },
  worried: { BrowInnerUp: 0.7, MouthFrownLeft: 0.25, MouthFrownRight: 0.25, MouthPressLeft: 0.2, MouthPressRight: 0.2 },
  surprised: { BrowInnerUp: 0.6, BrowOuterUpLeft: 0.7, BrowOuterUpRight: 0.7, EyeWideLeft: 0.6, EyeWideRight: 0.6, JawOpen: 0.22 },
  angry: { BrowDownLeft: 0.8, BrowDownRight: 0.8, EyeSquintLeft: 0.35, EyeSquintRight: 0.35, MouthPressLeft: 0.4, MouthPressRight: 0.4, NoseSneerLeft: 0.3, NoseSneerRight: 0.3 },
  thinking: { BrowDownLeft: 0.35, BrowOuterUpRight: 0.3, EyeSquintLeft: 0.15, EyeSquintRight: 0.15, MouthPressLeft: 0.25, MouthPressRight: 0.25, MouthLeft: 0.15 },
  skeptical: { BrowOuterUpLeft: 0.6, BrowDownRight: 0.3, MouthLeft: 0.2, MouthSmileRight: 0.15 },
  confident: { MouthSmileLeft: 0.22, MouthSmileRight: 0.22, BrowDownLeft: 0.1, BrowDownRight: 0.1 },
  curious: { BrowInnerUp: 0.35, BrowOuterUpLeft: 0.35, BrowOuterUpRight: 0.35, EyeWideLeft: 0.15, EyeWideRight: 0.15, MouthSmileLeft: 0.1, MouthSmileRight: 0.1 },
  disgusted: { NoseSneerLeft: 0.5, NoseSneerRight: 0.5, BrowDownLeft: 0.3, BrowDownRight: 0.3, MouthUpperUpLeft: 0.3, MouthUpperUpRight: 0.3 },
};
export const EXPRESSIONS = Object.keys(EXPR);

export function makeFace(mesh, words, speaking, seed = 1, msa = false) {
  const dict = mesh.morphTargetDictionary, inf = mesh.morphTargetInfluences;
  const find = (token) => { const k = Object.keys(dict).find((n) => n.endsWith(token) || n.includes("_" + token)); return k == null ? -1 : dict[k]; };
  const vIdx = Object.fromEntries(VIS.map((v, i) => [v, find(`VI_${String(i).padStart(2, "0")}_${v}`)]));
  const names = new Set(Object.values(EXPR).flatMap((e) => Object.keys(e)).concat(["EyeBlinkLeft", "EyeBlinkRight", "JawOpen"]));
  const aIdx = Object.fromEntries([...names].map((n) => [n, find(n)]));
  // أحداث البق: كل حرف ليه شكل ومدة جوه الكلمة
  const ev = [];
  if (speaking) for (const w of words || []) {
    const letters = [...w.word].map((c) => visemeOf(c, msa)).filter(Boolean);
    const d = (w.end - w.start) / Math.max(1, letters.length);
    letters.forEach((v, i) => ev.push({ v, s: w.start + i * d, e: w.start + (i + 1) * d, open: v === "aa" ? 1 : v === "U" || v === "I" ? 0.6 : 0.35 }));
  }
  // الرمش: كل 2.6 لـ 4.6 ثانية (ثابت لنفس البذرة)
  const blinks = []; let s = seed * 9301 + 49297, tb = 1.2;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  while (tb < 600) { blinks.push(tb); tb += 2.6 + r() * 2.0; }
  const qWords = (words || []).filter((w) => /[؟?]$/.test(w.word)); // آخر كلمة في سؤال: الحواجب بتترفع شوية

  return (t, exprA = "neutral", exprB = "neutral", mix = 1) => {
    for (let i = 0; i < inf.length; i++) inf[i] = 0;
    // التعبير (دمج بين وضعيتين)
    const A = EXPR[exprA] || {}, B = EXPR[exprB] || {};
    for (const n of names) { const w = (A[n] || 0) * (1 - mix) + (B[n] || 0) * mix; if (w && aIdx[n] >= 0) inf[aIdx[n]] = w; }
    // البق: كل شكل وزنه حسب قربه من وقته (دخول وخروج ناعمين)
    let jaw = 0;
    for (const x of ev) {
      if (t < x.s - 0.07 || t > x.e + 0.09) continue;
      const w = Math.min(smooth((t - x.s + 0.07) / 0.07), smooth((x.e + 0.09 - t) / 0.09)) * 0.62;
      const i = vIdx[x.v];
      if (i >= 0) inf[i] = Math.max(inf[i], w);
      jaw = Math.max(jaw, w * x.open * 0.2);
    }
    if (jaw && aIdx.JawOpen >= 0) inf[aIdx.JawOpen] = Math.max(inf[aIdx.JawOpen], jaw);
    // سؤال: الحواجب لفوق في آخر كلمة
    for (const w of qWords) { const q = Math.min(smooth((t - w.start + 0.1) / 0.2), smooth((w.end + 0.6 - t) / 0.3)); if (q > 0 && aIdx.BrowInnerUp >= 0) inf[aIdx.BrowInnerUp] = Math.max(inf[aIdx.BrowInnerUp], q * 0.45); }
    // الرمش
    let bl = 0;
    for (const b of blinks) { if (t >= b - 0.08 && t <= b + 0.1) { bl = t < b ? smooth((t - b + 0.08) / 0.08) : smooth((b + 0.1 - t) / 0.1); break; } if (b > t + 1) break; }
    for (const n of ["EyeBlinkLeft", "EyeBlinkRight"]) if (aIdx[n] >= 0) inf[aIdx[n]] = Math.max(inf[aIdx[n]], bl);
  };
}
