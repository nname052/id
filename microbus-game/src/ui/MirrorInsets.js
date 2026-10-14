import * as THREE from 'three';

// المرايات الجانبية كـ "شاشات صغيرة" على حرف الشاشة، بنفس صورة المراية الحقيقية (نفس الـ render target).
// ليه؟ في الهاي إس الكابينة فوق الموتور والمرايات جنب السواق تقريبًا، فالمراية اليمين بتبقى برا زاوية الرؤية،
// والشمال بتستخبى ورا الدركسيون اللي على شاشة الموبايل. فبنعرضهم على الجنب زي ألعاب المحاكاة.

const _v = new THREE.Vector3();

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const g = new THREE.ShapeGeometry(s, 6);
  // UV من 0 لـ 1 على المستطيل
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  return g;
}

export class MirrorInsets {
  constructor(player, touch) {
    this.player = player;
    this.touch = touch;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    this.items = [];
    this.mode = 'auto'; // auto | on | off
    for (const mc of player.mirrorCams || []) {
      if (mc.m.side === 0) continue;
      const frame = new THREE.Mesh(roundedRect(1, 1, 0.12), new THREE.MeshBasicMaterial({ color: 0x0c0c0e, depthTest: false }));
      const face = new THREE.Mesh(roundedRect(1, 1, 0.1), new THREE.MeshBasicMaterial({ map: mc.rt.texture, depthTest: false }));
      face.renderOrder = 1;
      this.scene.add(frame, face);
      this.items.push({ mc, frame, face, aspect: mc.m.aspect || 0.7 });
    }
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(W, H) {
    this.W = W; this.H = H;
    this.cam.right = W; this.cam.top = H; this.cam.updateProjectionMatrix();
    const touch = !!this.touch;
    // المقاس: على الموبايل بالعرض ~ ربع ارتفاع الشاشة ونص
    const h = Math.round(Math.min(H * (touch ? 0.31 : 0.26), 170));
    for (const it of this.items) {
      const w = Math.round(h * Math.min(1.6, Math.max(0.55, it.aspect)));
      const left = it.mc.m.side < 0;
      const top = touch ? 58 : Math.round(H * 0.3);
      const x = left ? 8 + w / 2 : W - 8 - w / 2;
      const y = H - top - h / 2;
      it.face.position.set(x, y, 0); it.face.scale.set(w, h, 1);
      it.frame.position.set(x, y, 0); it.frame.scale.set(w + 6, h + 6, 1);
    }
  }

  /** بترجع true لو فيه حاجة تترسم */
  update(camera, cockpit) {
    let any = false;
    for (const it of this.items) {
      let show = cockpit && this.mode !== 'off' && it.mc.renders > 0;
      if (show && this.mode === 'auto' && !this.touch) {
        // على الكمبيوتر: بنعرضها بس لو المراية الحقيقية برا الشاشة
        it.mc.m.face.getWorldPosition(_v).project(camera);
        show = !(Math.abs(_v.x) < 0.92 && Math.abs(_v.y) < 0.92 && _v.z < 1);
      }
      it.face.visible = it.frame.visible = show;
      it.shown = show;
      any ||= show;
    }
    return any;
  }

  render(renderer) {
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.cam);
    renderer.autoClear = ac;
  }
}
