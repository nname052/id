// ارتفاع الأرض ونوع السطح للفيزياء والصوت: شبين الكوم بتسجّل نفسها هنا (ShibinWorld) وكل اللي بيسأل عن الأرض بيروحلها
let provider = null;
/** p = { height(x, z, yHint), surface(x, z) } */
export function setGroundProvider(p) { provider = p; }

export function groundHeight(x, z, yHint) { return provider ? provider.height(x, z, yHint) : 0; }

/** نوع السطح (للصوت) */
export function surfaceAt(x, z) { return provider ? provider.surface(x, z) : 'city'; }
