import * as THREE from 'three';
import { humanVariants, seatedGeometry, humanStaticMaterial } from './Humans.js';

// ===== سواقين العربيات =====
// كام شكل جاهز (من نفس الناس شبه الحقيقيين) قاعدين وإيديهم على الدركسيون — نفس الـ geometry لكل العربيات (خفيف)
const _drivers = [];
function driverGeo(i, knee = -1.55) {
  const key = i + (knee !== -1.55 ? 10 : 0);
  if (!_drivers[key]) {
    const v = humanVariants(6, 9100);
    // السواقين رجالة (قميص/جلابية) في الغالب
    const pick = v.filter((h) => h.type === 'casual' || h.type === 'galabeya');
    const g = seatedGeometry((pick[i % pick.length] || v[i % v.length]).geo, { hands: 'wheel', knee });
    g.rotateY(Math.PI); // الوش ناحية -z زي العربية
    _drivers[key] = g;
  }
  return _drivers[key];
}

/** يقعد سواق: pos = مكان القعدة (الوش ناحية -z زي العربية) */
/** knee: زاوية الركبة (-1.55 = رجل نازلة على طول؛ أقل = الرجل ممدودة لقدام — للكرسي العالي زي التوكتوك عشان الرجل ماتطلعش من الأرضية) */
export function addDriver(parent, x, y, z, seed = 0, knee = -1.55) {
  const m = new THREE.Mesh(driverGeo(Math.abs(Math.floor(seed)) % 4, knee), humanStaticMaterial());
  m.position.set(x, y - 0.06, z);
  m.castShadow = false;
  m.userData.role = 'driver';
  parent.add(m);
  return m;
}
