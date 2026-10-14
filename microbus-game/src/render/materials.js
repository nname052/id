import * as THREE from 'three';
import * as T from './textures.js';

// كل الخامات المشتركة في مكان واحد (PBR: MeshStandard/MeshPhysical)
export function createMaterials() {
  const M = {};
  const std = (o) => new THREE.MeshStandardMaterial(o);

  const asphalt = T.makeAsphalt();
  M.asphalt = std({ ...asphalt, roughness: 1, metalness: 0, vertexColors: true, color: 0xffffff });
  M.asphalt.userData.baseRoughness = 1;
  M.asphalt.userData.castShadow = false;

  const side = T.makeSidewalk();
  M.sidewalkTop = std({ ...side, roughness: 0.92, vertexColors: true });
  M.sidewalkTop.userData.castShadow = false;
  M.curb = std({ map: T.makeCurb(), roughness: 0.85 });
  M.curbYellow = std({ map: T.makeCurb(['#e8c22a', '#1d1d1d']), roughness: 0.85 });
  M.dirt = std({ map: T.makeDirt(), roughness: 1 });

  const plaster = T.makePlasterWall();
  M.wallPlaster = std({ ...plaster, roughness: 0.95, vertexColors: true });
  const brick = T.makeBrickWall();
  M.wallBrick = std({ ...brick, roughness: 0.95, vertexColors: true });
  M.concrete = std({ map: T.makeConcrete(), roughness: 0.95, vertexColors: true });

  const fp = T.makeFacadeAtlas('plaster');
  M.facadePlaster = std({ ...fp, roughness: 1, vertexColors: true, emissive: 0x000000, emissiveIntensity: 0 });
  const fb = T.makeFacadeAtlas('brick');
  M.facadeBrick = std({ ...fb, roughness: 1, vertexColors: true, emissive: 0x000000, emissiveIntensity: 0 });
  // الإضاءة الليلية للشبابيك (هتشتغل في وضع الليل)
  for (const m of [M.facadePlaster, M.facadeBrick]) { m.emissive.set(0xffffff); m.emissiveIntensity = 0; }

  const shop = T.makeShopAtlas();
  M.shop = std({ ...shop, roughness: 0.8, emissive: 0xffffff, emissiveIntensity: 0.15 });
  const signs = T.makeSignAtlas();
  M.signs = std({ map: signs.map, emissiveMap: signs.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.55 });
  M.clinic = std({ map: T.makeClinicAtlas(), roughness: 0.6, side: THREE.DoubleSide });
  M.ac = std({ map: T.makeACTexture(), roughness: 0.7, metalness: 0.1 });
  M.metal = std({ color: 0x2c2c2e, roughness: 0.6, metalness: 0.6, vertexColors: true });
  M.paintedMetal = std({ color: 0xffffff, roughness: 0.55, metalness: 0.3, vertexColors: true });
  M.tank = std({ color: 0x1a1a1a, roughness: 0.6 });
  M.dish = std({ color: 0xd8d8d4, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
  M.cloth = std({ roughness: 0.9, vertexColors: true, side: THREE.DoubleSide });
  M.cloth.userData.castShadow = true;
  M.awning = std({ roughness: 0.85, vertexColors: true, side: THREE.DoubleSide });
  M.plastic = std({ roughness: 0.5, vertexColors: true });

  M.paint = std({ color: 0xf2f0e6, roughness: 0.65, alphaMap: T.makePaintWear(), transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
  M.paintYellow = M.paint.clone(); M.paintYellow.color.set(0xe8c030);
  M.stain = std({ color: 0x000000, alphaMap: T.makeStain(), transparent: true, opacity: 1, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false, vertexColors: true });
  M.patch = std({ ...asphalt, color: 0x77746f, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const mh = T.makeManhole();
  M.manhole = std({ ...mh, roughness: 0.55, metalness: 0.65, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

  M.leaves = std({ map: T.makeLeaves(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });
  M.palm = std({ map: T.makePalmFrond(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85 });
  M.trunk = std({ color: 0xffffff, roughness: 0.95, vertexColors: true });
  M.lampGlass = std({ color: 0xfff6e0, emissive: 0xffe8b0, emissiveIntensity: 0.0, roughness: 0.2 });

  M.glass = new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.38, envMapIntensity: 1.6, depthWrite: false });

  return M;
}

/** خامات العربيات */
export function vehicleMaterials(color = 0xf3f3f0) {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, vertexColors: false }),
    plasticBlack: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.65 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.12, metalness: 1 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.92, normalMap: _tread(), normalScale: new THREE.Vector2(1.5, 1.5) }),
    rim: new THREE.MeshStandardMaterial({ color: 0xbfc2c4, roughness: 0.35, metalness: 0.85, vertexColors: true }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x1c262c, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.32, envMapIntensity: 2.0, depthWrite: false, side: THREE.DoubleSide }),
    windshield: new THREE.MeshPhysicalMaterial({ color: 0x8fa6a8, roughness: 0.0, metalness: 0, transparent: true, opacity: 0.1, envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xf8f8f0, emissive: 0xfff4d8, emissiveIntensity: 0.05, roughness: 0.1, metalness: 0.5 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x8a0a0a, emissive: 0xff1a10, emissiveIntensity: 0.15, roughness: 0.2 }),
    indicator: new THREE.MeshStandardMaterial({ color: 0xd08010, emissive: 0xff9010, emissiveIntensity: 0.1, roughness: 0.2 }),
    underbody: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
    rimFace: _rimFace(),
  };
}

let _rimFaceMat = null;
function _rimFace() { return (_rimFaceMat ||= new THREE.MeshStandardMaterial({ map: T.makeRimTexture(6), roughness: 0.3, metalness: 0.75 })); }
let _treadTex = null;
function _tread() { return (_treadTex ||= T.makeTireTread()); }
