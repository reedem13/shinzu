import * as THREE from 'three';
import { anyOverlap } from '../public/js/geom.js';
import {
  canTakedown,
  emptyMission,
  findHook,
  makeGuard,
  makePlayer,
  stepGuards,
  stepMission,
  stepPlayer,
} from '../public/js/sim.js';
import { buildWorld } from '../public/js/world.js';

const scene = new THREE.Scene();
const world = buildWorld(scene);
const guards = world.patrols.map((def) => makeGuard(def));

function blocked(x, y, z, height = 1.68) {
  return anyOverlap(x, y, z, 0.32, height, world.colliders);
}

for (const [id, spawn] of Object.entries(world.spawns)) {
  if (blocked(spawn.x, spawn.y, spawn.z)) throw new Error(`spawn blocked: ${id}`);
}

for (const guard of guards) {
  if (anyOverlap(guard.pos.x, guard.pos.y, guard.pos.z, 0.3, 1.55, world.colliders)) {
    throw new Error(`guard blocked: ${guard.id} @ ${guard.pos.x.toFixed(2)}, ${guard.pos.y.toFixed(2)}, ${guard.pos.z.toFixed(2)}`);
  }
}

let badLands = 0;
for (const hook of world.hooks) {
  if (blocked(hook.land.x, hook.land.y + 0.02, hook.land.z)) {
    badLands += 1;
    console.error('land blocked', hook.id, hook.land.x.toFixed(2), hook.land.y.toFixed(2), hook.land.z.toFixed(2));
  }
}
if (badLands) throw new Error(`${badLands} grapple landings are inside geometry`);
if (world.hooks.length < 12) throw new Error(`expected more hook points, got ${world.hooks.length}`);

const still = {
  moveX: 0, moveZ: 0, jump: false, crouchToggle: false, grapple: false, act: false, camYaw: 0, camPitch: 0.1,
};

const walker = makePlayer('p1', 'Sable', world.spawns.p1);
const west = { ...still, moveX: -1, camYaw: 0 };
for (let i = 0; i < 200; i++) stepPlayer(walker, west, 1 / 60, world, null);
if (walker.pos.x < -20.2) throw new Error(`walked through the west wall at x=${walker.pos.x.toFixed(2)}`);

const grappler = makePlayer('p1', 'Sable', world.spawns.p1);
const eye = new THREE.Vector3(grappler.pos.x, grappler.pos.y + 1.45, grappler.pos.z);
let aim = null;
let aimedHook = null;
for (const hook of world.hooks) {
  if (hook.land.y < 2.4) continue;
  const dx = hook.position.x - eye.x;
  const dy = hook.position.y - eye.y;
  const dz = hook.position.z - eye.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 2 || dist > 12) continue;
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  const found = findHook(eye, dir, world.hooks, world.colliders);
  if (found && found.land.y > 2.4) {
    aim = { origin: eye, dir };
    aimedHook = found;
    break;
  }
}
if (!aim) throw new Error('no grapple hook is visible from the spawn');
stepPlayer(grappler, {
  ...still,
  grapple: true,
  camYaw: Math.atan2(aim.dir.x, aim.dir.z),
  camPitch: Math.atan2(aim.dir.y, Math.hypot(aim.dir.x, aim.dir.z)),
}, 1 / 60, world, aim);
if (grappler.state !== 'grapple') throw new Error(`grapple did not fire toward ${aimedHook.id}`);
for (let i = 0; i < 360; i++) {
  stepPlayer(grappler, { ...still, camYaw: grappler.yaw }, 1 / 60, world, null);
  if (grappler.state === 'move' && grappler.pos.y > 2.2) break;
}
if (grappler.pos.y < 2.2) throw new Error(`grapple missed the roof, y=${grappler.pos.y.toFixed(2)} state=${grappler.state}`);

const gate = guards.find((guard) => guard.id === 'gate');
const behind = makePlayer('p1', 'Sable', {
  x: gate.pos.x - Math.sin(gate.yaw) * 1.05,
  y: 0,
  z: gate.pos.z - Math.cos(gate.yaw) * 1.05,
  yaw: gate.yaw,
});
behind.grounded = true;
behind.crouch = true;
if (!canTakedown(behind, gate)) throw new Error('rear takedown was rejected');
const ahead = makePlayer('p1', 'Sable', {
  x: gate.pos.x + Math.sin(gate.yaw) * 1.05,
  y: 0,
  z: gate.pos.z + Math.cos(gate.yaw) * 1.05,
  yaw: gate.yaw,
});
ahead.grounded = true;
if (canTakedown(ahead, gate)) throw new Error('takedown allowed from the front');

const seen = makePlayer('p1', 'Sable', {
  x: gate.pos.x + Math.sin(gate.yaw) * 3.2,
  y: 0,
  z: gate.pos.z + Math.cos(gate.yaw) * 3.2,
  yaw: 0,
});
seen.connected = true;
seen.horizSpeed = 0;
seen.crouch = false;
for (let i = 0; i < 40; i++) stepGuards(guards, [seen], 1 / 30, world);
if (gate.awareness < 0.4) throw new Error(`guard vision did not build suspicion (${gate.awareness.toFixed(2)})`);

gate.awareness = 0;
gate.state = 'patrol';
gate.focusId = null;
const hidden = makePlayer('p1', 'Sable', {
  x: gate.pos.x + Math.sin(gate.yaw) * 7.2,
  y: 0,
  z: gate.pos.z + Math.cos(gate.yaw) * 7.2,
  yaw: 0,
});
hidden.connected = true;
hidden.crouch = true;
hidden.horizSpeed = 0.4;
const beforeHidden = gate.awareness;
for (let i = 0; i < 20; i++) stepGuards(guards, [hidden], 1 / 30, world);
if (gate.awareness > beforeHidden + 0.15) throw new Error(`crouch at distance was spotted (${gate.awareness.toFixed(2)})`);

const mission = emptyMission();
const solo = makePlayer('p1', 'Sable', { x: 0, y: 0, z: 22.7, yaw: 0 });
solo.connected = true;
solo.state = 'move';
stepMission(mission, [solo], guards, world.extract);
if (mission.won) throw new Error('mission completed before the target was down');
guards.find((guard) => guard.isTarget).alive = false;
stepMission(mission, [solo], guards, world.extract);
if (!mission.won) throw new Error('solo host did not complete at the ford');

const paired = emptyMission();
const partner = makePlayer('p2', 'Cinder', { x: 0, y: 0, z: 8, yaw: 0 });
partner.connected = true;
partner.state = 'move';
stepMission(paired, [solo, partner], guards, world.extract);
if (paired.won) throw new Error('won while the second shinobi was still out');
partner.pos.set(0.3, 0, 22.4);
stepMission(paired, [solo, partner], guards, world.extract);
if (!paired.won) throw new Error('both shinobi at the ford should win');

const street = guards.find((guard) => guard.id === 'street');
street.awareness = 0;
street.state = 'patrol';
const startX = street.pos.x;
const startZ = street.pos.z;
for (let i = 0; i < 120; i++) stepGuards([street], [], 1 / 30, world);
if (Math.hypot(street.pos.x - startX, street.pos.z - startZ) < 0.5) {
  throw new Error('street patrol did not move');
}

const climber = makePlayer('p1', 'Sable', { x: -17.65, y: 0.4, z: 12.55, yaw: Math.PI / 2 });
climber.grounded = false;
climber.vel.y = 0.2;
const climbInput = { ...still, camYaw: Math.PI / 2 };
for (let i = 0; i < 8; i++) stepPlayer(climber, climbInput, 1 / 60, world, null);
if (climber.state !== 'hang' && climber.state !== 'pullup') {
  throw new Error(`ledge grab failed, state=${climber.state} y=${climber.pos.y.toFixed(2)}`);
}

console.log(`simcheck ok — ${guards.length} guards, ${world.hooks.length} hooks`);
