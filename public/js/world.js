import * as THREE from 'three';

// Orchard Gate — an original walled hamlet.
// ART SWAP: every gameplay object is a Group. Meshes live under `userData.visual`
// (or are themselves named wall / roof / hookPoint). Colliders are separate data
// in world space, 1 unit = 1 meter, feet at y = 0. Replace visuals, keep colliders,
// hook.land positions, and patrol points.

const M = {
  ground: mat(0x3c3a34),
  path: mat(0x6a5e4e),
  stone: mat(0x726e68),
  stoneDark: mat(0x55514c),
  plaster: mat(0xd2c4ae),
  plasterTall: mat(0xcbb89a),
  wood: mat(0x6e4b34),
  woodDark: mat(0x4a3124),
  roof: mat(0x3a2c30, { side: THREE.DoubleSide }),
  roofDark: mat(0x2c2226),
  water: mat(0x2a3c44),
  trunk: mat(0x3b2b22),
  leaf: mat(0x31493a),
  crate: mat(0x7a5436),
  lantern: mat(0xffb15e, { emissive: 0xff7a2a, emissiveIntensity: 0.85 }),
  hook: mat(0xb9fff4, { emissive: 0x6dfff0, emissiveIntensity: 1 }),
  hookWood: mat(0x3f2c22),
  ford: mat(0x31484a),
  extract: mat(0x3f8f72, { emissive: 0x1f6e52, emissiveIntensity: 0.55 }),
  banner: mat(0x7c2430),
  metal: mat(0x7e868e),
};

function mat(color, extra = {}) {
  return new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
    ...extra,
  });
}

function collider(list, x, y, z, sx, sy, sz, tag, flags = {}) {
  list.push({
    minX: x - sx / 2,
    maxX: x + sx / 2,
    minY: y - sy / 2,
    maxY: y + sy / 2,
    minZ: z - sz / 2,
    maxZ: z + sz / 2,
    tag,
    ...flags,
  });
}

function addBox(parent, colliders, spec) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(spec.sx, spec.sy, spec.sz), spec.material);
  mesh.position.set(spec.x, spec.y, spec.z);
  mesh.name = spec.name;
  mesh.userData.kind = spec.name;
  mesh.castShadow = spec.shadow !== false;
  mesh.receiveShadow = true;
  parent.add(mesh);
  if (spec.solid !== false) {
    const ox = spec.ox || 0;
    const oy = spec.oy || 0;
    const oz = spec.oz || 0;
    collider(colliders, spec.x + ox, spec.y + oy, spec.z + oz, spec.sx, spec.sy, spec.sz, spec.name, spec.flags || {});
  }
  return mesh;
}

function makePrism(length, width, rise) {
  const hl = length / 2;
  const hw = width / 2;
  const positions = new Float32Array([
    -hl, 0, hw, hl, 0, hw, hl, rise, 0,
    -hl, 0, hw, hl, rise, 0, -hl, rise, 0,
    -hl, 0, -hw, -hl, rise, 0, hl, rise, 0,
    -hl, 0, -hw, hl, rise, 0, hl, 0, -hw,
    -hl, 0, -hw, -hl, 0, hw, -hl, rise, 0,
    hl, 0, hw, hl, 0, -hw, hl, rise, 0,
    -hl, 0, -hw, hl, 0, -hw, hl, 0, hw,
    -hl, 0, -hw, hl, 0, hw, -hl, 0, hw,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function addHook(parent, collidersIgnored, hooks, world, local, land) {
  const group = new THREE.Group();
  group.name = 'hookPoint';
  group.userData.kind = 'hookPoint';
  group.userData.id = `hook-${hooks.length}`;
  group.position.set(local.x, local.y, local.z);
  const visual = new THREE.Group();
  visual.name = 'visual';
  group.userData.visual = visual;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.72, 6), M.hookWood);
  pole.position.y = 0.2;
  pole.castShadow = true;
  visual.add(pole);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), M.hook.clone());
  glow.position.y = 0.66;
  glow.name = 'hookPoint';
  visual.add(glow);
  group.add(visual);
  parent.add(group);
  hooks.push({
    id: group.userData.id,
    mesh: group,
    glow: glow.material,
    position: new THREE.Vector3(world.x + local.x, world.y + local.y + 0.66, world.z + local.z),
    land: new THREE.Vector3(land.x, land.y, land.z),
  });
}

function addHouse(root, colliders, hooks, spec) {
  const group = new THREE.Group();
  group.name = 'house';
  group.userData.kind = 'house';
  group.userData.id = spec.id;
  group.position.set(spec.x, 0, spec.z);
  const visual = new THREE.Group();
  visual.name = 'visual';
  group.userData.visual = visual;
  group.add(visual);
  root.add(group);

  const world = { x: spec.x, y: 0, z: spec.z };
  const w = spec.w;
  const d = spec.d;
  const wallH = spec.wallH;
  const t = 0.34;
  const hw = w / 2;
  const hd = d / 2;
  const gap = 1.64;
  const wallMat = spec.tall ? M.plasterTall : M.plaster;

  const place = (name, x, y, z, sx, sy, sz, material) => {
    addBox(visual, colliders, {
      name,
      x,
      y,
      z,
      sx,
      sy,
      sz,
      material,
      ox: world.x,
      oy: 0,
      oz: world.z,
    });
  };

  const wallSide = (side) => {
    if (side === 'n' || side === 's') {
      const z = side === 'n' ? -hd + t / 2 : hd - t / 2;
      if (spec.door === side) {
        const seg = (w - gap) / 2;
        place('wall', -gap / 2 - seg / 2, wallH / 2, z, seg, wallH, t, wallMat);
        place('wall', gap / 2 + seg / 2, wallH / 2, z, seg, wallH, t, wallMat);
      } else {
        place('wall', 0, wallH / 2, z, w, wallH, t, wallMat);
      }
    } else {
      const x = side === 'w' ? -hw + t / 2 : hw - t / 2;
      if (spec.door === side) {
        const seg = (d - gap) / 2;
        place('wall', x, wallH / 2, -gap / 2 - seg / 2, t, wallH, seg, wallMat);
        place('wall', x, wallH / 2, gap / 2 + seg / 2, t, wallH, seg, wallMat);
      } else {
        place('wall', x, wallH / 2, 0, t, wallH, d, wallMat);
      }
    }
  };
  for (const side of ['n', 's', 'w', 'e']) wallSide(side);

  const deckW = w + 1.55;
  const deckD = d + 1.55;
  const deckT = 0.22;
  const eaveY = wallH + deckT;
  place('roof', 0, wallH + deckT / 2, 0, deckW, deckT, deckD, M.woodDark);

  const longX = w >= d;
  const rise = spec.rise ?? 1.35;
  const prismLen = (longX ? w : d) * 0.7;
  const prismWid = (longX ? d : w) * 0.5;
  const prismSX = longX ? prismLen : prismWid;
  const prismSZ = longX ? prismWid : prismLen;
  const prism = new THREE.Mesh(makePrism(prismSX, prismSZ, rise), M.roof);
  prism.position.y = eaveY;
  prism.name = 'roof';
  prism.userData.kind = 'roof';
  prism.castShadow = true;
  prism.receiveShadow = true;
  visual.add(prism);
  collider(colliders, world.x, eaveY + rise / 2, world.z, prismSX, rise, prismSZ, 'roof');

  const capT = 0.16;
  const capLen = prismLen * 0.86;
  const capWid = 1.02;
  place(
    'roof',
    0,
    eaveY + rise + capT / 2,
    0,
    longX ? capLen : capWid,
    capT,
    longX ? capWid : capLen,
    M.roofDark,
  );
  const capY = eaveY + rise + capT;

  // Windows — emissive slabs, not colliders.
  const winY = wallH * 0.55;
  const windowSpec = [
    [0, winY, -hd - 0.02, 0.7, 0.46, 0.08],
    [0, winY, hd + 0.02, 0.7, 0.46, 0.08],
  ];
  if (spec.door !== 'w') windowSpec.push([-hw - 0.02, winY, 0, 0.08, 0.46, 0.55]);
  if (spec.door !== 'e') windowSpec.push([hw + 0.02, winY, 0, 0.08, 0.46, 0.55]);
  for (const [x, y, z, sx, sy, sz] of windowSpec) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), M.lantern);
    win.position.set(x, y, z);
    win.name = 'lantern';
    win.userData.kind = 'lantern';
    visual.add(win);
  }

  if (spec.tall) {
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.55), M.banner);
    banner.name = 'banner';
    banner.position.set(-hw - 0.08, wallH * 0.72, 0);
    visual.add(banner);
  }

  const hookBaseY = eaveY;
  const sides = [
    { x: 0, z: -(hd + 0.78), axis: 'z', sign: -1 },
    { x: 0, z: hd + 0.78, axis: 'z', sign: 1 },
    { x: -(hw + 0.78), z: 0, axis: 'x', sign: -1 },
    { x: hw + 0.78, z: 0, axis: 'x', sign: 1 },
  ];
  for (const side of sides) {
    const deckHalf = side.axis === 'z' ? deckD / 2 : deckW / 2;
    const prismHalf = side.axis === 'z' ? prismSZ / 2 : prismSX / 2;
    const shoulder = deckHalf - prismHalf;
    if (shoulder < 1.02) continue;
    const landDist = prismHalf + Math.min(0.72, shoulder - 0.42);
    const land = {
      x: world.x + (side.axis === 'x' ? side.sign * landDist : 0),
      y: eaveY,
      z: world.z + (side.axis === 'z' ? side.sign * landDist : 0),
    };
    addHook(group, null, hooks, world, { x: side.x, y: hookBaseY, z: side.z }, land);
  }

  // One hook aimed at the ridge cap, on the long end.
  if (longX) {
    addHook(
      group,
      null,
      hooks,
      world,
      { x: capLen / 2 + 0.15, y: capY - 0.1, z: 0 },
      { x: world.x + capLen / 2 - 0.7, y: capY, z: world.z },
    );
  } else {
    addHook(
      group,
      null,
      hooks,
      world,
      { x: 0, y: capY - 0.1, z: capLen / 2 + 0.15 },
      { x: world.x, y: capY, z: world.z + capLen / 2 - 0.7 },
    );
  }

  return { id: spec.id, x: spec.x, z: spec.z, w, d, wallH, eaveY, capY, deckW, deckD, group };
}

function addTree(root, colliders, x, z, scale = 1) {
  const group = new THREE.Group();
  group.name = 'tree';
  group.userData.kind = 'tree';
  group.position.set(x, 0, z);
  const visual = new THREE.Group();
  visual.name = 'visual';
  group.userData.visual = visual;
  const trunkH = 1.15 * scale;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * scale, 0.2 * scale, trunkH, 6), M.trunk);
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  visual.add(trunk);
  const leafH = 2.3 * scale;
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.9 * scale, leafH, 6), M.leaf);
  leaves.position.y = trunkH + leafH * 0.38;
  leaves.castShadow = true;
  visual.add(leaves);
  group.add(visual);
  root.add(group);
  collider(colliders, x, trunkH / 2, z, 0.42 * scale, trunkH, 0.42 * scale, 'tree');
}

export function buildWorld(scene) {
  const colliders = [];
  const hooks = [];
  const root = new THREE.Group();
  root.name = 'hamlet';
  scene.add(root);

  const ground = new THREE.Mesh(new THREE.BoxGeometry(78, 1, 78), M.ground);
  ground.position.y = -0.5;
  ground.name = 'ground';
  ground.userData.kind = 'ground';
  ground.receiveShadow = true;
  root.add(ground);
  collider(colliders, 0, -0.5, 0, 78, 1, 78, 'ground');

  // Packed-earth paths.
  const path = (x, y, z, sx, sz) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.04, sz), M.path);
    mesh.position.set(x, y, z);
    mesh.name = 'path';
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  path(0, 0.02, 2, 2.3, 30);
  path(-8, 0.02, -2, 14, 2.1);
  path(8, 0.02, 8, 2.1, 12);

  // Perimeter walls. Interior faces sit near ±19.4. Tops are walkable.
  const wallH = 3.55;
  const wallT = 1.7;
  const wallGroup = new THREE.Group();
  wallGroup.name = 'wall';
  wallGroup.userData.kind = 'wall';
  wallGroup.userData.id = 'perimeter';
  const wallVisual = new THREE.Group();
  wallVisual.name = 'visual';
  wallGroup.userData.visual = wallVisual;
  wallGroup.add(wallVisual);
  root.add(wallGroup);

  const wallBox = (x, z, sx, sz) => {
    addBox(wallVisual, colliders, {
      name: 'wall',
      x,
      y: wallH / 2,
      z,
      sx,
      sy: wallH,
      sz,
      material: M.stone,
    });
    // Darker cap so the walk reads.
    const cap = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.08, 0.12, sz + 0.08), M.stoneDark);
    cap.position.set(x, wallH + 0.04, z);
    cap.name = 'wall';
    wallVisual.add(cap);
  };
  // South wall with a gate. Gate gap x = -2.35 .. 2.35. Wall center z = 20.35.
  wallBox(-11.9, 20.35, 16.9, wallT);
  wallBox(11.9, 20.35, 16.9, wallT);
  wallBox(0, -20.35, 42.4, wallT);
  wallBox(-20.35, 0, wallT, 42.4);
  wallBox(20.35, 0, wallT, 42.4);

  const houses = {};
  const specs = [
    { id: 'houseWest', x: -13.6, z: -1.6, w: 7.1, d: 6.1, wallH: 3.05, door: 'e', rise: 1.28 },
    { id: 'houseNorth', x: 1.2, z: -12.4, w: 9.2, d: 5.6, wallH: 3.15, door: 's', rise: 1.42 },
    { id: 'houseEast', x: 13.2, z: -4.6, w: 6.2, d: 7.2, wallH: 3.2, door: 'w', rise: 1.3 },
    { id: 'houseEnvoy', x: 8.1, z: 7.6, w: 9.0, d: 7.3, wallH: 4.15, door: 'w', rise: 1.5, tall: true },
    { id: 'shed', x: -11.4, z: 11.6, w: 5.3, d: 4.7, wallH: 2.7, door: 's', rise: 1.05 },
    { id: 'store', x: -3.4, z: -1.6, w: 4.5, d: 4.5, wallH: 3.05, door: 's', rise: 1.16 },
  ];
  for (const spec of specs) houses[spec.id] = addHouse(root, colliders, hooks, spec);

  // Bridge between the west house and the store, at the shared eave.
  const bridgeY = houses.houseWest.eaveY;
  const bridge = new THREE.Group();
  bridge.name = 'walkway';
  bridge.userData.kind = 'walkway';
  bridge.userData.id = 'westBridge';
  const bridgeVisual = new THREE.Group();
  bridgeVisual.name = 'visual';
  bridge.userData.visual = bridgeVisual;
  bridge.add(bridgeVisual);
  root.add(bridge);
  addBox(bridgeVisual, colliders, {
    name: 'walkway',
    x: -8.15,
    y: bridgeY - 0.09,
    z: -1.6,
    sx: 3.5,
    sy: 0.18,
    sz: 1.65,
    material: M.wood,
  });
  // Posts.
  for (const px of [-9.55, -6.75]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, bridgeY, 0.18), M.woodDark);
    post.position.set(px, bridgeY / 2, -2.45);
    post.name = 'walkway';
    post.castShadow = true;
    bridgeVisual.add(post);
  }

  // L-shaped gallery from the store's south side to the envoy's west shoulder.
  const gallery = new THREE.Group();
  gallery.name = 'walkway';
  gallery.userData.kind = 'walkway';
  gallery.userData.id = 'gallery';
  const galleryVisual = new THREE.Group();
  galleryVisual.name = 'visual';
  gallery.userData.visual = galleryVisual;
  gallery.add(galleryVisual);
  root.add(gallery);
  const gy = houses.store.eaveY;
  addBox(galleryVisual, colliders, {
    name: 'walkway',
    x: -3.4,
    y: gy - 0.09,
    z: 2.55,
    sx: 1.6,
    sy: 0.18,
    sz: 5.3,
    material: M.wood,
  });
  addBox(galleryVisual, colliders, {
    name: 'walkway',
    x: -0.55,
    y: gy - 0.09,
    z: 5.05,
    sx: 4.3,
    sy: 0.18,
    sz: 1.65,
    material: M.wood,
  });
  addBox(galleryVisual, colliders, {
    name: 'walkway',
    x: 1.45,
    y: gy - 0.09,
    z: 7.7,
    sx: 1.85,
    sy: 0.18,
    sz: 5.5,
    material: M.wood,
  });

  // Short plank from the west wall-walk onto the west roof.
  addBox(root, colliders, {
    name: 'walkway',
    x: -18.55,
    y: houses.houseWest.eaveY - 0.09,
    z: -1.6,
    sx: 2.15,
    sy: 0.18,
    sz: 1.5,
    material: M.wood,
  });

  // Practice beam in the spawn pocket: jump, hang, pull up. It does not reach a roof.
  addBox(root, colliders, {
    name: 'walkway',
    x: -16.55,
    y: 0.72,
    z: 12.55,
    sx: 1.35,
    sy: 1.44,
    sz: 1.15,
    material: M.wood,
  });

  // Low screen in the south street. Cover, not a camera trap.
  addBox(root, colliders, {
    name: 'wall',
    x: -9.4,
    y: 0.7,
    z: 15.6,
    sx: 2.4,
    sy: 1.4,
    sz: 0.4,
    material: M.stoneDark,
  });

  // Crates for cover.
  const crateAt = (x, z, layers = 1) => {
    for (let i = 0; i < layers; i++) {
      addBox(root, colliders, {
        name: 'crate',
        x,
        y: 0.29 + i * 0.58,
        z,
        sx: 0.58,
        sy: 0.58,
        sz: 0.58,
        material: M.crate,
      });
    }
  };
  crateAt(-16.9, 16.6, 2);
  crateAt(-9.2, 4.4, 1);
  crateAt(-6.4, -5.6, 1);
  crateAt(4.4, 2.2, 1);
  crateAt(14.6, 6.4, 2);
  crateAt(2.4, 13.4, 1);

  // Well.
  const well = new THREE.Group();
  well.name = 'well';
  well.userData.kind = 'well';
  well.position.set(-7.2, 0, -6.5);
  const wellVisual = new THREE.Group();
  wellVisual.name = 'visual';
  well.userData.visual = wellVisual;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.86, 0.92, 10), M.stone);
  ring.position.y = 0.46;
  ring.castShadow = true;
  wellVisual.add(ring);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 10), M.water);
  water.position.y = 0.7;
  wellVisual.add(water);
  well.add(wellVisual);
  root.add(well);
  collider(colliders, -7.2, 0.46, -6.5, 1.7, 0.92, 1.7, 'well');

  // Interior screen inside the envoy house.
  addBox(root, colliders, {
    name: 'wall',
    x: 8.3,
    y: 1.05,
    z: 7.55,
    sx: 0.28,
    sy: 2.1,
    sz: 2.4,
    material: M.woodDark,
  });

  addTree(root, colliders, -7.8, 15.4, 1.05);
  addTree(root, colliders, 16.4, -13.6, 1.2);
  addTree(root, colliders, -17.2, -14.2, 1.15);
  addTree(root, colliders, 5.8, 14.8, 0.9);
  addTree(root, colliders, 16.8, 8.5, 1);

  // Hook points on the wall-walk and the gallery, in addition to each roof.
  const wallTop = wallH;
  const hookOnWall = (x, z, landX, landZ) => {
    addHook(root, null, hooks, { x: 0, y: 0, z: 0 }, { x, y: wallTop + 0.05, z }, { x: landX, y: wallTop, z: landZ });
  };
  hookOnWall(-19.2, 8, -20.35, 8);
  hookOnWall(-19.2, -8, -20.35, -8);
  hookOnWall(6, 19.35, 6, 20.35);
  hookOnWall(-19.2, 14.2, -20.35, 14.2);

  addHook(
    root,
    null,
    hooks,
    { x: 0, y: 0, z: 0 },
    { x: 1.45, y: gy + 0.15, z: 10.2 },
    { x: 1.45, y: gy, z: 9.3 },
  );

  // Ford and extract outside the south gate.
  const ford = new THREE.Group();
  ford.name = 'extract';
  ford.userData.kind = 'extract';
  ford.position.set(0, 0, 22.7);
  const fordVisual = new THREE.Group();
  fordVisual.name = 'visual';
  ford.userData.visual = fordVisual;
  const waterPad = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.08, 4.4), M.ford);
  waterPad.position.y = 0.03;
  waterPad.receiveShadow = true;
  fordVisual.add(waterPad);
  const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.07, 6, 28), M.extract);
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.position.y = 0.12;
  ringMesh.name = 'extract';
  fordVisual.add(ringMesh);
  const postL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.18), M.woodDark);
  postL.position.set(-2.4, 0.65, 0);
  fordVisual.add(postL);
  const postR = postL.clone();
  postR.position.x = 2.4;
  fordVisual.add(postR);
  ford.add(fordVisual);
  root.add(ford);
  const extractRing = ringMesh;

  // A few lantern posts.
  const lanternAt = (x, z) => {
    const g = new THREE.Group();
    g.name = 'lantern';
    g.userData.kind = 'lantern';
    g.position.set(x, 0, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.7, 5), M.woodDark);
    pole.position.y = 0.85;
    g.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.28), M.lantern);
    lamp.position.y = 1.78;
    lamp.name = 'lantern';
    g.add(lamp);
    root.add(g);
  };
  lanternAt(-15.9, 16.6);
  lanternAt(2.5, 7.6);
  lanternAt(-2.2, -8.4);
  lanternAt(3.6, 17.2);

  const west = houses.houseWest;
  const north = houses.houseNorth;
  const envoy = houses.houseEnvoy;

  const patrols = [
    {
      id: 'gate',
      points: [
        { x: -2.6, y: 0, z: 17.15 },
        { x: 2.7, y: 0, z: 17.15 },
      ],
      pause: 1.1,
    },
    {
      id: 'street',
      points: [
        { x: 0.15, y: 0, z: 3.4 },
        { x: 0.15, y: 0, z: -7.4 },
        { x: 3.3, y: 0, z: -7.4 },
        { x: 0.15, y: 0, z: 1.2 },
      ],
      pause: 0.7,
    },
    {
      id: 'alley',
      points: [
        { x: -16.9, y: 0, z: 3.4 },
        { x: -16.9, y: 0, z: -8.6 },
        { x: -10.6, y: 0, z: -8.6 },
        { x: -16.9, y: 0, z: -4.2 },
      ],
      pause: 0.8,
    },
    {
      id: 'court',
      points: [
        { x: -5.2, y: 0, z: -8.7 },
        { x: 4.6, y: 0, z: -8.7 },
        { x: 4.6, y: 0, z: -4.5 },
        { x: -4.2, y: 0, z: -4.5 },
      ],
      pause: 0.9,
    },
    {
      id: 'east',
      points: [
        { x: 15.6, y: 0, z: 1.2 },
        { x: 15.6, y: 0, z: 12.4 },
        { x: 12.2, y: 0, z: 14.2 },
        { x: 15.6, y: 0, z: 6.5 },
      ],
      pause: 0.75,
    },
    {
      id: 'door',
      points: [
        { x: 2.15, y: 0, z: 5.85 },
        { x: 2.15, y: 0, z: 9.45 },
      ],
      pause: 1.15,
    },
    {
      id: 'inside',
      points: [
        { x: 6.15, y: 0, z: 9.55 },
        { x: 6.15, y: 0, z: 5.7 },
      ],
      pause: 1.35,
      speed: 0.85,
    },
    {
      id: 'bridge',
      roam: false,
      points: [
        { x: -9.15, y: bridgeY, z: -1.6 },
        { x: -7.15, y: bridgeY, z: -1.6 },
      ],
      pause: 1.4,
      speed: 0.7,
    },
    {
      id: 'ridge',
      roam: false,
      points: [
        { x: north.x - 2.1, y: north.capY, z: north.z },
        { x: north.x + 2.3, y: north.capY, z: north.z },
      ],
      pause: 1.5,
      speed: 0.68,
    },
    {
      id: 'gallery',
      roam: false,
      points: [
        { x: 1.45, y: gy, z: 6.15 },
        { x: 1.45, y: gy, z: 9.55 },
      ],
      pause: 1.2,
      speed: 0.72,
    },
    {
      id: 'voss',
      isTarget: true,
      pacifist: true,
      speed: 0.58,
      chaseSpeed: 1.25,
      pause: 1.7,
      points: [
        { x: 5.55, y: 0, z: 9.7 },
        { x: 10.55, y: 0, z: 9.7 },
        { x: 10.55, y: 0, z: 5.55 },
        { x: 5.55, y: 0, z: 5.55 },
      ],
    },
  ];

  // A hook that is obvious from the spawn pocket, landing on the shed eave.
  const shed = houses.shed;
  addHook(
    root,
    null,
    hooks,
    { x: 0, y: 0, z: 0 },
    { x: shed.x, y: shed.eaveY + 0.9, z: shed.z + shed.d / 2 + 1.7 },
    { x: shed.x, y: shed.eaveY, z: shed.z + 1.9 },
  );

  return {
    root,
    colliders,
    hooks,
    houses,
    patrols,
    extract: { x: 0, y: 0, z: 22.7, r: 3.15 },
    spawns: {
      p1: { x: -12.8, y: 0, z: 15.7, yaw: 2.55 },
      p2: { x: -14.3, y: 0, z: 16.7, yaw: 2.45 },
    },
    focus: { x: 1.5, y: 2.2, z: 0.5 },
    bridgeY,
    west,
    envoy,
    extractRing,
  };
}

export const HAMLET_NAME = 'Orchard Gate';
