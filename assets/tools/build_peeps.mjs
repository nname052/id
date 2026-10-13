// يحوّل مكتبة Open Peeps (من @dicebear/open-peeps) لملف واحد يشتغل في المتصفح من غير build: assets/peeps/peeps.js
// التشغيل (fetch_assets.py بيعمله لوحده): node build_peeps.mjs <فولدر node_modules> <ملف الخرج>
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const [nodeModules, outFile] = process.argv.slice(2);
const pkg = (p) => pathToFileURL(join(nodeModules, "@dicebear", "open-peeps", "lib", p)).href;
const { create, meta } = await import(pkg("index.js"));
const components = await import(pkg("components/index.js"));

// الألوان بتتحط كعلامات، والمتصفح بيبدّلها بالألوان اللي تختارها
const COLORS = { skin: "#__SKIN__", clothing: "#__CLOTHING__", headContrast: "#__HEADCONTRAST__" };
const GROUPS = ["head", "face", "facialHair", "mask", "accessories"];

const parts = {};
for (const group of GROUPS) {
  parts[group] = {};
  for (const [name, fn] of Object.entries(components[group])) parts[group][name] = fn({}, COLORS);
}

// الجسم: create من غير أي جزء، وبعدين نحط علامة مكان كل جزء بالترتيب
const prng = { pick: (arr, fallback) => (arr && arr.length ? arr[0] : fallback), bool: () => false };
const options = { skinColor: ["__SKIN__"], clothingColor: ["__CLOTHING__"], headContrastColor: ["__HEADCONTRAST__"] };
let body = create({ prng, options }).body;
let i = 0;
body = body.replace(/(<g transform="[^"]+">)(<\/g>)/g, (_, open, close) => `${open}{{${GROUPS[i++]}}}${close}`);
if (i !== GROUPS.length) throw new Error(`لقيت ${i} أماكن للأجزاء بدل ${GROUPS.length}`);

const js = `/* Open Peeps: ${meta.creator}، ${meta.source}. رخصة الرسومات ${meta.license.name}. الملف ده متولّد من build_peeps.mjs */
(function () {
  const BODY = ${JSON.stringify(body)};
  const PARTS = ${JSON.stringify(parts)};
  const DEFAULTS = { skin: "#d08b5b", clothing: "#ff8906", headContrast: "#2c1b18" };
  function fill(svg, c) {
    return svg.split("#__SKIN__").join(c.skin).split("#__CLOTHING__").join(c.clothing).split("#__HEADCONTRAST__").join(c.headContrast);
  }
  /** بيرجّع SVG كامل (viewBox 0 0 704 704). options: {head, face, facialHair, mask, accessories, skin, clothing, headContrast} */
  function svg(options = {}) {
    const c = { ...DEFAULTS, ...options };
    let out = BODY;
    for (const g of ${JSON.stringify(GROUPS)}) out = out.replace("{{" + g + "}}", (options[g] && PARTS[g][options[g]]) || "");
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 704 704" fill="none">' + fill(out, c) + "</svg>";
  }
  /** نفس svg بس بيرجّع المحتوى من غير <svg>، علشان تحطه جوه <g> وتحرّكه */
  function inner(options = {}) { return svg(options).replace(/^<svg[^>]*>|<\\/svg>$/g, ""); }
  window.Peeps = { svg, inner, parts: Object.fromEntries(Object.entries(PARTS).map(([k, v]) => [k, Object.keys(v)])) };
})();
`;
writeFileSync(outFile, js);
console.log(`peeps.js: ${Object.entries(parts).map(([k, v]) => `${k}=${Object.keys(v).length}`).join(", ")}`);
