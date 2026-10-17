// حاجات مرسومة بالكود بمقاسها الحقيقي (للحاجات اللي مفيش منها نسخة سليمة المقاس في المكتبات).
// كل حاجة: نقطة الأصل في نص القاعدة (زي باقي الحاجات)، والمقاس بالمتر، ومعاها shape لنظام المسك (grasp.js).
import * as THREE from "three";

// كتاب مقفول نايم على ضهره: العرض w (x)، الطول h (z، طول الكعب)، السُمك d (y). الكعب ناحية -x
export const BOOK = { w: 0.155, h: 0.23, d: 0.028 };
export function makeBook(opts = {}) {
  const { w, h, d } = { ...BOOK, ...opts };
  const cover = new THREE.MeshStandardMaterial({ color: opts.color || "#7b2d26", roughness: 0.6 });
  const paper = new THREE.MeshStandardMaterial({ color: "#efe6d2", roughness: 0.9 });
  const g = new THREE.Group(), t = 0.0025, inset = 0.004;
  const board = (y) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, t, h), cover); b.position.y = y; g.add(b); };
  board(t / 2); board(d - t / 2);                                                    // الجلدتين
  const spine = new THREE.Mesh(new THREE.BoxGeometry(t, d, h), cover); spine.position.set(-w / 2 + t / 2, d / 2, 0); g.add(spine);
  const pages = new THREE.Mesh(new THREE.BoxGeometry(w - t - inset, d - 2 * t, h - 2 * inset), paper); // الورق جوه
  pages.position.set(t / 2 - inset / 2, d / 2, 0); g.add(pages);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.shape = { kind: "box", w, h: d, d: h }; // للمسك: الارتفاع = السُمك (نايم)
  g.userData.procedural = "book";
  return g;
}
export const PROCEDURAL = { book: { make: makeBook, real_m: [BOOK.w, BOOK.d, BOOK.h], label: "closed book lying flat (w x thickness x height)" } };
