import * as THREE from 'three';
import { VIEW_HALF, VIEW_RANGE } from './sim.js';

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function lighten(hex, amount = 42) {
  const r = Math.min(255, ((hex >> 16) & 255) + amount);
  const g = Math.min(255, ((hex >> 8) & 255) + amount);
  const b = Math.min(255, (hex & 255) + amount);
  return (r << 16) | (g << 8) | b;
}

function makeLabel(text, fill) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = fill;
  ctx.font = '600 36px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(1.15, 0.29, 1);
  sprite.position.y = 2.08;
  return sprite;
}

function makeBadge() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.48, 0.48, 0.48);
  sprite.position.y = 2.22;
  sprite.visible = false;
  sprite.userData.paint = (text, color) => {
    if (sprite.userData.last === `${text}${color}`) return;
    sprite.userData.last = `${text}${color}`;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = color;
    ctx.font = '700 92px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 68);
    texture.needsUpdate = true;
  };
  return sprite;
}

export function createPlayerView(scene, objectName, label, color) {
  const root = new THREE.Group();
  root.name = objectName;
  root.userData.kind = 'player';
  root.userData.id = objectName;
  const visual = new THREE.Group();
  visual.name = 'visual';
  root.userData.visual = visual;

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.92, 4, 8), lambert(color));
  body.position.y = (0.92 + 0.56) / 2;
  body.castShadow = true;
  body.name = 'body';
  visual.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), lambert(lighten(color, 48)));
  head.position.y = 1.52;
  head.castShadow = true;
  visual.add(head);

  const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.1, 0.26), lambert(0xe4dccb));
  scarf.position.y = 1.26;
  scarf.castShadow = true;
  visual.add(scarf);

  const nameplate = makeLabel(label, '#efe8da');
  root.add(visual);
  root.add(nameplate);
  scene.add(root);
  return { root, visual, label: nameplate };
}

export function createGuardView(scene, guard) {
  const root = new THREE.Group();
  root.name = guard.isTarget ? 'target' : 'guard';
  root.userData.kind = root.name;
  root.userData.id = guard.id;
  const visual = new THREE.Group();
  visual.name = 'visual';
  root.userData.visual = visual;

  const color = guard.isTarget ? 0xc6a15a : 0x5c564c;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.88, 4, 8), lambert(color));
  body.position.y = (0.88 + 0.6) / 2;
  body.castShadow = true;
  body.name = 'body';
  visual.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), lambert(guard.isTarget ? 0xe2c48a : 0x6e675f));
  head.position.y = 1.52;
  head.castShadow = true;
  visual.add(head);

  const hatGeo = guard.isTarget
    ? new THREE.CylinderGeometry(0.1, 0.16, 0.46, 6)
    : new THREE.ConeGeometry(0.34, 0.2, 8);
  const hat = new THREE.Mesh(hatGeo, lambert(guard.isTarget ? 0x7a1f2b : 0x2a2725));
  hat.position.y = guard.isTarget ? 1.92 : 1.74;
  hat.castShadow = true;
  visual.add(hat);

  if (guard.isTarget) {
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.36), lambert(0x7a1f2b));
    sash.position.y = 1.12;
    visual.add(sash);
  }

  const length = VIEW_RANGE;
  const radius = Math.tan(VIEW_HALF) * length;
  const coneGeo = new THREE.ConeGeometry(radius, length, 20, 1, true);
  coneGeo.translate(0, -length / 2, 0);
  coneGeo.rotateX(-Math.PI / 2);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xffe29a,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.y = 1.48;
  cone.name = 'vision';
  cone.renderOrder = 2;

  const badge = makeBadge();
  root.add(visual);
  root.add(cone);
  root.add(badge);
  scene.add(root);
  return { root, visual, cone, coneMat, badge };
}

export function syncPlayer(player, dt) {
  const view = player.view;
  if (!view) return;
  const draw = player.draw || player.pos;
  view.root.visible = player.connected !== false;
  view.root.position.set(draw.x, draw.y, draw.z);
  view.root.rotation.set(0, player.yaw, 0);
  const target = player.crouch ? 0.64 : 1;
  view.visual.scale.y += (target - view.visual.scale.y) * Math.min(1, dt * 12);
  const hanging = player.state === 'hang';
  view.visual.rotation.x = hanging ? 0.7 : 0;
  view.visual.position.z = hanging ? 0.1 : 0;
  view.visual.position.y = hanging ? -0.05 : 0;
}

export function syncGuard(guard, view, dt) {
  if (!guard.alive) guard.fall = Math.min(1, (guard.fall || 0) + dt * 2.5);
  else guard.fall = 0;
  view.root.position.set(guard.pos.x, guard.pos.y, guard.pos.z);
  view.root.rotation.y = guard.yaw;
  view.visual.rotation.x = -Math.PI * 0.5 * guard.fall;
  view.visual.position.y = guard.fall * 0.32;
  view.cone.visible = guard.alive;
  if (!guard.alive) {
    view.badge.visible = false;
    return;
  }
  if (guard.state === 'chase') {
    view.coneMat.color.setHex(0xff5d4a);
    view.coneMat.opacity = 0.2;
    view.badge.visible = true;
    view.badge.userData.paint('!', '#ff6a55');
  } else if (guard.state === 'suspicious' || guard.state === 'search') {
    view.coneMat.color.setHex(0xffb15a);
    view.coneMat.opacity = 0.16;
    view.badge.visible = true;
    view.badge.userData.paint('?', '#ffd39a');
  } else {
    view.coneMat.color.setHex(0xffe7ad);
    view.coneMat.opacity = 0.11;
    view.badge.visible = false;
  }
}

const ropeUp = new THREE.Vector3(0, 1, 0);
const ropeDir = new THREE.Vector3();

export function makeRope(scene) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0xf0e2c8 }),
  );
  mesh.name = 'rope';
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

export function updateRope(rope, player) {
  if (!player || player.state !== 'grapple' || !player.grapple) {
    rope.visible = false;
    return;
  }
  const hook = player.grapple.hook.position;
  const ax = player.pos.x;
  const ay = player.pos.y + 1.15;
  const az = player.pos.z;
  const dx = hook.x - ax;
  const dy = hook.y - ay;
  const dz = hook.z - az;
  const len = Math.hypot(dx, dy, dz) || 0.001;
  ropeDir.set(dx / len, dy / len, dz / len);
  rope.visible = true;
  rope.scale.set(1, len, 1);
  rope.position.set(ax + dx * 0.5, ay + dy * 0.5, az + dz * 0.5);
  rope.quaternion.setFromUnitVectors(ropeUp, ropeDir);
}

export function pulseHooks(hooks, time, aimedId) {
  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i];
    const hot = aimedId && hook.id === aimedId;
    hook.glow.emissiveIntensity = (hot ? 1.7 : 0.7) + Math.sin(time * 3.2 + i * 0.7) * 0.28;
    const s = hot ? 1.28 : 1;
    hook.mesh.scale.setScalar(s);
  }
}
