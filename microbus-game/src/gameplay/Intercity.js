// =====================================================================
//  موقف السفر (المرحلة 7): في المحطة الرئيسية للمدينة (قطر/موقف — من OSM، نفس مكان البداية) لو وقفت فاضي
//  بيطلع كارت بأقرب 4 مدن (المسافة الحقيقية بخط مستقيم × 1.25 للطريق). سواق ميكروباص/أتوبيس/تاكسي = سفرية
//  بركاب (بتكسب)، باقي العربيات = بنزين ومصاريف الطريق (بتدفع). الاختيار بيفتح المدينة التانية بنفس العربية والفلوس.
// =====================================================================
import { MAPS, currentMap, switchMap } from '../world/maps.js';

const EARN = { microbus: 1.6, bus: 2.4, taxi: 1.1 }; // ج لكل كم (السفرية بعد البنزين)
const COST = 0.55;                                  // ج لكل كم (بنزين + كارتة) للعربيات التانية

function km(a, b) {
  const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.25;
}

export class Intercity {
  constructor({ world, hud, wallet, passengers }) {
    Object.assign(this, { world, hud, wallet, passengers });
    const st = world?.mainStation?.();
    this.hub = st ? (world.roadPose(st.x, st.z) || { x: st.x, z: st.z }) : null;
    if (this.hub) this.hub.name = st.name;
    this.map = currentMap();
    this._armed = null; this._stopT = 0; // (null: أول فريم — لو بدأت اللعبة جوه الموقف مايتفتحش لحد ما تبعد وترجع)
  }

  destinations() {
    const here = this.map;
    return MAPS.filter((m) => m.id !== here.id && !m.hidden).map((m) => ({ m, km: Math.round(km(here, m)) })).sort((a, b) => a.km - b.km).slice(0, 4);
  }

  update(dt, ph, kind) {
    const H = this.hub;
    if (!H) return;
    const d = Math.hypot(H.x - ph.x, H.z - ph.z);
    if (this._armed === null) this._armed = d > 60;
    if (d > 60) { this._armed = true; this._hinted = false; return; }
    if (!this._hinted && d < 45) { this._hinted = true; this.hud?.toast('🚌 موقف السفر — اقف هنا لو عايز تسافر مدينة تانية', 3); }
    if (!this._armed || this.hud?.cardOpen) return;
    this._stopT = d < 30 && Math.abs(ph.speed) < 0.8 ? this._stopT + dt : 0;
    if (this._stopT < 1.5) return;
    this._stopT = 0; this._armed = false; // (لحد ما تبعد وترجع)
    if (this.passengers?.onboard?.length) { this.hud?.toast('نزّل الركاب الأول قبل السفر', 2.4); return; }
    this.open(kind);
  }

  open(kind) {
    const earn = EARN[kind], D = this.destinations();
    const money = (k) => Math.round(earn ? k * earn : -k * COST);
    this.hud?.showCard({
      title: `🚌 موقف السفر — ${this.hub.name || this.map.name}`, tone: '',
      rows: D.map(({ m, km: k }) => [`${m.name} (${k} كم)`, `${money(k) >= 0 ? '+' : ''}${money(k)} ج`]),
      note: earn ? 'سفرية بركاب: بتكسب على قد المسافة' : 'بنزين وكارتة الطريق على حسابك',
      buttons: [...D.slice(0, 3).map(({ m, km: k }) => ({ label: m.name, sub: `${k} كم`, onClick: () => this.travel(m, money(k)) })), { label: 'مش دلوقتي', cls: 'alt' }],
    });
  }

  travel(m, money) {
    this.wallet?.add(money, 'travel', `سفر لـ ${m.name}`);
    this.hud?.toast(`🛣 مسافر على ${m.name}…`, 2);
    this.traveling = m.id;
    setTimeout(() => switchMap(m.id), 1200);
  }
}
