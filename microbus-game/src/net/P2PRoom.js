// =====================================================================
//  اللعب الجماعي برا Claude (اللينك العام): اتصال مباشر بين الأجهزة (WebRTC) عن طريق Trystero.
//  الأجهزة بتلاقي بعض عن طريق سيرفرات Nostr عامة ببلاش (مفيش سيرفر بتاعنا ولا حسابات)، وبعد كده
//  حالة كل لاعب (رقمه، اسمه، عربيته، مكانه) بتتبعت مباشرة للباقيين.
//  نفس واجهة الـ room بتاع Claude اللي Multiplayer بيستخدمها: presence / peers / onPeers / onConnection / connected
// =====================================================================

const LOBBY_KEYS = ['seat', 'name', 'kind', 'map'];

export async function joinP2PRoom(roomName) {
  const { joinRoom, selfId } = await import('trystero');
  const room = joinRoom({ appId: 'egy-microbus-shibin-v1' }, roomName);
  const st = room.makeAction('st');
  const me = { peer: selfId, sameTab: true, kind: 'viewer', presence: {}, updatedAt: 0 };
  const others = new Map();
  const peerFns = [], connFns = [];
  let joined = false;
  const notify = () => { for (const f of peerFns) try { f(); } catch { /* */ } };

  room.onPeerJoin = (id) => {
    if (!others.has(id)) others.set(id, { peer: id, sameTab: false, kind: 'viewer', presence: {}, updatedAt: 0 });
    joined = true;
    st.send(me.presence, { target: id }); // اللي لسه داخل ياخد حالتي على طول
    for (const f of connFns) try { f(); } catch { /* */ }
    notify();
  };
  room.onPeerLeave = (id) => { others.delete(id); notify(); };
  st.onMessage = (data, { peerId }) => {
    if (!data || typeof data !== 'object') return;
    let p = others.get(peerId);
    if (!p) { p = { peer: peerId, sameTab: false, kind: 'viewer', presence: {}, updatedAt: 0 }; others.set(peerId, p); }
    // (اللي جاي من حد تاني بيانات بس: أرقام ونصوص قصيرة — مش بنثق فيها في أي حاجة غير الرسم)
    const lobbyChanged = LOBBY_KEYS.some((k) => p.presence[k] !== data[k]);
    p.presence = data;
    p.updatedAt = performance.now();
    if (lobbyChanged) notify();
  };

  return {
    mode: 'p2p',
    connected: () => true,
    hasPeers: () => joined && others.size > 0,
    peers: () => [me, ...others.values()],
    presence(patch) {
      Object.assign(me.presence, patch);
      try { st.send(me.presence); } catch { /* لسه مفيش حد */ }
      return Promise.resolve();
    },
    onPeers(fn) { peerFns.push(fn); },
    onConnection(fn) { connFns.push(fn); },
    leave: () => room.leave(),
  };
}
