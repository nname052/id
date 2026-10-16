// حاجات الشخصية بتتعامل معاها بجد: تلاجة بتتفتح، لابتوب على مكتب، باب، شباك، كوباية قهوة، كتاب.
// كلها متبنية بالكود (علشان الباب/الغطا يقدر يتحرك)، وكل واحدة ليها "مكان الوقوف" ومقبض بتمسكه الإيد.
import * as THREE from "three";

const mat = (look, color, o = {}) => look === "anime"
  ? new THREE.MeshToonMaterial({ color, ...o }) : new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, ...o });
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
const box = (w, h, d, m) => { const x = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); x.castShadow = x.receiveShadow = true; return x; };

// تلاجة: الضهر للحيطة (وشها لـ +z)، والباب بيتفتح على المفصلة اللي في الشمال (من ناحية الشخصية اللي واقفة قدامها)
export function fridge(scene, look, x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const W = 0.78, H = 1.85, Dp = 0.7, white = mat(look, "#eef0f2"), steel = mat(look, "#b8bec6", { metalness: 0.6, roughness: 0.3 });
  const body = new THREE.Group();
  body.add(at(box(W, 0.04, Dp, white), 0, 0.02, 0));
  body.add(at(box(W, 0.04, Dp, white), 0, H - 0.02, 0));
  body.add(at(box(0.04, H, Dp, white), -W / 2 + 0.02, H / 2, 0));
  body.add(at(box(0.04, H, Dp, white), W / 2 - 0.02, H / 2, 0));
  body.add(at(box(W, H, 0.04, white), 0, H / 2, -Dp / 2 + 0.02));
  // جوه: رفوف ونور وحاجات
  const inner = mat(look, "#ffffff", { emissive: "#dff4ff", emissiveIntensity: 0.35 });
  for (const y of [0.45, 0.85, 1.25, 1.6]) body.add(at(box(W - 0.1, 0.02, Dp - 0.12, mat(look, "#cfe8f5", { transparent: true, opacity: 0.85 })), 0, y, 0.02));
  const back = at(box(W - 0.09, H - 0.1, 0.01, inner), 0, H / 2, -Dp / 2 + 0.05); body.add(back);
  const items = [["#e94b3c", 0.12, 0.2, -0.2, 0.47], ["#f4c542", 0.1, 0.16, 0.05, 0.47], ["#6abf69", 0.14, 0.12, 0.22, 0.87], ["#ffffff", 0.08, 0.26, -0.18, 0.87],
    ["#ff9f43", 0.16, 0.1, 0.1, 1.27], ["#4a90d9", 0.09, 0.22, -0.22, 1.27], ["#f8f1e5", 0.2, 0.08, 0.05, 1.62]];
  for (const [c, w, h, ix, y] of items) body.add(at(box(w, h, 0.12, mat(look, c)), ix, y + h / 2, -0.05));
  const light = new THREE.PointLight("#e8f6ff", 0, 2.2, 2); light.position.set(0, 1.3, 0.1); body.add(light);
  g.add(body);
  // الباب على مفصلة (الحرف الشمال)
  const hinge = new THREE.Group(); hinge.position.set(-W / 2, 0, Dp / 2); g.add(hinge);
  const door = at(box(W, H, 0.05, white), W / 2, H / 2, 0.025); hinge.add(door);
  const handle = at(box(0.03, 0.55, 0.04, steel), W - 0.08, 1.15, 0.08); hinge.add(handle);
  scene.add(g);
  return {
    name: "fridge", group: g, stand: new THREE.Vector3(x + 0.1, 0, z + Dp / 2 + 0.62), face: 180,
    handle: () => handle.getWorldPosition(new THREE.Vector3()),
    set: (open) => { hinge.rotation.y = -open * 1.85; light.intensity = open * 3.5; },
  };
}

// مكتب عليه لابتوب، والكرسي ورا المكتب ناحية الكاميرا (الشخصية قاعدة وشها لينا والشاشة قدامها)
export function laptopDesk(scene, look, x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const wood = mat(look, "#8a6a4f"), dark = mat(look, "#2a2d34", { metalness: 0.4, roughness: 0.35 });
  g.add(at(box(1.2, 0.04, 0.62, wood), 0, 0.74, 0));
  for (const [lx, lz] of [[-0.56, -0.27], [0.56, -0.27], [-0.56, 0.27], [0.56, 0.27]]) g.add(at(box(0.04, 0.72, 0.04, wood), lx, 0.36, lz));
  const base = at(box(0.34, 0.018, 0.24, dark), 0, 0.77, -0.04); g.add(base);
  // الغطا متصل من ورا (ناحية الكاميرا) والشاشة بتبص لورا ناحية الشخصية
  const hinge = new THREE.Group(); hinge.position.set(0, 0.78, 0.08); g.add(hinge);
  const lid = at(box(0.34, 0.012, 0.23, dark), 0, 0, -0.115); hinge.add(lid);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.2), new THREE.MeshBasicMaterial({ color: "#9fd0ff" }));
  screen.position.set(0, -0.008, -0.115); screen.rotation.x = Math.PI / 2; hinge.add(screen);
  const glow = new THREE.PointLight("#9fd0ff", 0, 1.6, 2); glow.position.set(0, 0.95, -0.25); g.add(glow);
  const mug = at(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 18), mat(look, "#f2ede4")), 0.42, 0.81, 0.05); g.add(mug);
  scene.add(g);
  return {
    name: "laptop", group: g, seat: new THREE.Vector3(x, 0, z - 0.62), face: 0, keys: () => base.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, 0)),
    set: (open) => { hinge.rotation.x = -open * 1.85; glow.intensity = open * 1.6; screen.visible = open > 0.4; },
  };
}

// باب في الحيطة اليمين، بيتفتح لجوه
export function wallDoor(scene, look, x, z, wallColor = "#e9dccb") {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = -Math.PI / 2;
  const frameM = mat(look, "#f4f1ea"), wood = mat(look, "#7a5a40");
  g.add(at(box(0.06, 2.12, 0.12, frameM), -0.48, 1.06, 0));
  g.add(at(box(0.06, 2.12, 0.12, frameM), 0.48, 1.06, 0));
  g.add(at(box(1.02, 0.08, 0.12, frameM), 0, 2.14, 0));
  const dark = at(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.08), new THREE.MeshBasicMaterial({ color: "#1d1a17" })), 0, 1.04, -0.05); g.add(dark);
  const hinge = new THREE.Group(); hinge.position.set(-0.45, 0, 0.02); g.add(hinge);
  const panel = at(box(0.9, 2.06, 0.045, wood), 0.45, 1.03, 0); hinge.add(panel);
  const knob = at(new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), mat(look, "#d4b26a", { metalness: 0.8, roughness: 0.25 })), 0.8, 1.0, 0.06); hinge.add(knob);
  scene.add(g);
  void wallColor;
  return {
    name: "door", group: g, stand: new THREE.Vector3(x - 0.75, 0, z + 0.15), face: 90,
    handle: () => knob.getWorldPosition(new THREE.Vector3()),
    set: (open) => { hinge.rotation.y = open * 1.3; },
  };
}

// شباك كبير في الحيطة اللي ورا (فيه سما بالليل أو بالنهار)
export function wallWindow(scene, look, x, z, time) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const frameM = mat(look, "#f7f5f0");
  const c = document.createElement("canvas"); c.width = 4; c.height = 128;
  const gg = c.getContext("2d"), gr = gg.createLinearGradient(0, 0, 0, 128);
  const sky = { night: ["#071234", "#29407a"], sunset: ["#3a2a6e", "#ffb070"], day: ["#5aa9e6", "#d8efff"] }[time] || ["#5aa9e6", "#d8efff"];
  gr.addColorStop(0, sky[0]); gr.addColorStop(1, sky[1]); gg.fillStyle = gr; gg.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: tex }));
  glass.position.set(0, 1.55, 0.01); g.add(glass);
  for (const [w, h, px, py] of [[1.42, 0.07, 0, 2.23], [1.42, 0.07, 0, 0.87], [0.07, 1.42, -0.68, 1.55], [0.07, 1.42, 0.68, 1.55], [0.04, 1.3, 0, 1.55], [1.3, 0.04, 0, 1.55]])
    g.add(at(box(w, h, 0.06, frameM), px, py, 0.03));
  g.add(at(box(1.5, 0.05, 0.18, frameM), 0, 0.85, 0.09));
  const light = new THREE.SpotLight(time === "night" ? "#8fa8ff" : "#fff2d8", time === "night" ? 6 : 14, 6, 0.6, 0.7, 1.5);
  light.position.set(0, 1.6, -0.3); light.target.position.set(0, 0, 2); g.add(light, light.target);
  scene.add(g);
  return { name: "window", group: g, stand: new THREE.Vector3(x, 0, z + 0.85), face: 180 };
}

// حاجات في الإيد
export function handProp(kind, look) {
  const g = new THREE.Group();
  if (kind === "mug") {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.1, 20), mat(look, "#f2ede4")); g.add(m);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 8, 16), mat(look, "#f2ede4")); handle.position.set(0.05, 0, 0); g.add(handle);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.037, 20), mat(look, "#5a3a22")); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.045; g.add(coffee);
  } else if (kind === "book") {
    const cover = mat(look, "#8c2f39"), paper = mat(look, "#f6f0e2");
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.21, 0.02), paper); l.position.set(-0.075, 0, 0); l.rotation.y = 0.35; g.add(l);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.21, 0.02), paper); r.position.set(0.075, 0, 0); r.rotation.y = -0.35; g.add(r);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.22, 0.008), cover); back.position.z = -0.03; g.add(back);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
