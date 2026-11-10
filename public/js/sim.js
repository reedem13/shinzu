import * as THREE from 'three';
import {
  angleDiff,
  anyOverlap,
  clamp,
  findLedge,
  moveWithCollision,
  nearestClear,
  segmentClear,
} from './geom.js';

export const PLAYER_RADIUS = 0.32;
export const WALK_SPEED = 1.55;
export const CROUCH_SPEED = 0.76;
export const GRAVITY = 16.5;
export const JUMP_V = 4.85;
export const GRAPPLE_SPEED = 5.6;
export const VIEW_RANGE = 8.6;
export const VIEW_HALF = 0.4;
export const TAKEDOWN_RANGE = 1.45;

export function playerHeight(player) {
  return player.crouch ? 1.05 : 1.68;
}

export function makePlayer(id, name, spawn) {
  return {
    id,
    name,
    pos: new THREE.Vector3(spawn.x, spawn.y, spawn.z),
    vel: new THREE.Vector3(),
    yaw: spawn.yaw || 0,
    camYaw: spawn.yaw || 0,
    camPitch: 0.16,
    crouch: false,
    grounded: true,
    state: 'move',
    horizSpeed: 0,
    aimHook: null,
    hang: null,
    grapple: null,
    grappleTime: 0,
    takedown: null,
    strikeLock: 0,
    connected: true,
    exposure: 0,
    alert: 'unseen',
  };
}

export function makeGuard(def) {
  const a = def.points[0];
  const b = def.points[Math.min(1, def.points.length - 1)];
  return {
    id: def.id,
    isTarget: !!def.isTarget,
    pacifist: !!def.pacifist,
    roam: def.roam !== false,
    speed: def.speed ?? (def.isTarget ? 0.62 : 1.02),
    chaseSpeed: def.chaseSpeed ?? (def.pacifist ? 1.35 : 2.15),
    pause: def.pause ?? 0.85,
    points: def.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    wp: 0,
    wait: def.pause ?? 0.4,
    pos: new THREE.Vector3(a.x, a.y, a.z),
    yaw: Math.atan2(b.x - a.x, b.z - a.z),
    state: 'patrol',
    awareness: 0,
    focusId: null,
    lastKnown: new THREE.Vector3(a.x, a.y, a.z),
    loseSight: 0,
    searchTime: 0,
    strikeCd: 0,
    shoutCd: 0,
    alive: true,
    fall: 0,
    floorY: a.y,
    seeing: false,
    hearing: false,
  };
}

export function findHook(origin, dir, hooks, boxes) {
  let best = null;
  let bestAng = 0.34;
  for (const hook of hooks) {
    const dx = hook.position.x - origin.x;
    const dy = hook.position.y - origin.y;
    const dz = hook.position.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1.35 || dist > 15) continue;
    const ang = Math.acos(clamp((dx * dir.x + dy * dir.y + dz * dir.z) / dist, -1, 1));
    if (ang > bestAng) continue;
    if (!segmentClear(origin.x, origin.y, origin.z, hook.position.x, hook.position.y, hook.position.z, boxes, 0.45)) {
      continue;
    }
    best = hook;
    bestAng = ang;
  }
  return best;
}

function bodyClears(x, y, z, player, boxes) {
  return !anyOverlap(x, y + 0.02, z, PLAYER_RADIUS, playerHeight(player), boxes);
}

export function stepPlayer(player, input, dt, world, aim) {
  const boxes = world.colliders;
  player.strikeLock = Math.max(0, player.strikeLock - dt);
  player.camYaw = input.camYaw;
  player.camPitch = input.camPitch;

  const canAim = player.state === 'move' || player.state === 'hang';
  if (aim && canAim) {
    player.aimHook = findHook(aim.origin, aim.dir, world.hooks, boxes);
  } else if (player.state !== 'grapple') {
    player.aimHook = null;
  }

  if (input.grapple && player.aimHook && canAim) {
    const hook = player.aimHook;
    player.state = 'grapple';
    player.hang = null;
    player.vel.set(0, 0, 0);
    player.grappleTime = 0;
    player.grapple = {
      phase: 'out',
      hook,
      approach: hook.position.clone(),
      land: hook.land.clone(),
    };
    player.crouch = false;
  }

  if (player.state === 'grapple') {
    stepGrapple(player, dt, boxes);
    player.horizSpeed = GRAPPLE_SPEED;
    player.yaw = player.camYaw;
    return;
  }

  if (player.state === 'takedown') {
    const td = player.takedown;
    td.t += dt;
    const u = clamp(td.t / td.dur, 0, 1);
    const k = u * u * (3 - 2 * u);
    player.pos.lerpVectors(td.from, td.to, k);
    player.vel.set(0, 0, 0);
    player.horizSpeed = 0;
    if (u >= 1) {
      player.pos.copy(td.to);
      player.state = 'move';
      player.takedown = null;
      player.grounded = true;
    }
    return;
  }

  if (player.state === 'pullup') {
    const pull = player.pull;
    pull.t += dt;
    const u = clamp(pull.t / pull.dur, 0, 1);
    const k = u * u * (3 - 2 * u);
    player.pos.lerpVectors(pull.from, pull.to, k);
    player.pos.y += Math.sin(u * Math.PI) * 0.28;
    player.vel.set(0, 0, 0);
    player.horizSpeed = 0;
    if (u >= 1) {
      const spot = nearestClear(pull.to.x, pull.to.y, pull.to.z, PLAYER_RADIUS, playerHeight(player), boxes);
      player.pos.set(spot.x, spot.y, spot.z);
      player.state = 'move';
      player.pull = null;
      player.grounded = true;
      player.vel.y = -2;
    }
    return;
  }

  if (player.state === 'hang') {
    player.vel.set(0, 0, 0);
    player.horizSpeed = 0;
    player.grounded = false;
    player.pos.x += (player.hang.x - player.pos.x) * Math.min(1, dt * 14);
    player.pos.y += (player.hang.y - player.pos.y) * Math.min(1, dt * 14);
    player.pos.z += (player.hang.z - player.pos.z) * Math.min(1, dt * 14);
    const drop = input.crouchToggle || input.moveZ < -0.55;
    const rise = input.jump || input.act;
    if (drop) {
      player.state = 'move';
      player.pos.x -= player.hang.fx * 0.22;
      player.pos.z -= player.hang.fz * 0.22;
      player.vel.y = -1.4;
      player.hang = null;
      return;
    }
    if (rise) {
      const onto = nearestClear(
        player.hang.hitX + player.hang.fx * 0.22,
        player.hang.lipY,
        player.hang.hitZ + player.hang.fz * 0.22,
        PLAYER_RADIUS,
        playerHeight(player),
        boxes,
      );
      player.state = 'pullup';
      player.pull = {
        t: 0,
        dur: 0.62,
        from: player.pos.clone(),
        to: new THREE.Vector3(onto.x, onto.y, onto.z),
      };
      player.hang = null;
    }
    return;
  }

  if (input.crouchToggle && player.grounded) player.crouch = !player.crouch;

  const height = playerHeight(player);
  if (!player.crouch && anyOverlap(player.pos.x, player.pos.y, player.pos.z, PLAYER_RADIUS, 1.68, boxes)) {
    player.crouch = true;
  }

  const mag = Math.hypot(input.moveX, input.moveZ);
  let ix = input.moveX;
  let iz = input.moveZ;
  if (mag > 1) {
    ix /= mag;
    iz /= mag;
  }
  const speed = player.crouch ? CROUCH_SPEED : WALK_SPEED;
  const yaw = player.camYaw;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Screen-right is forward × up because this camera looks along +forward.
  const rx = -Math.cos(yaw);
  const rz = Math.sin(yaw);
  const desiredX = (fx * iz + rx * ix) * speed;
  const desiredZ = (fz * iz + rz * ix) * speed;
  const blend = 1 - Math.exp(-6.2 * dt);
  player.vel.x += (desiredX - player.vel.x) * blend;
  player.vel.z += (desiredZ - player.vel.z) * blend;
  player.yaw = yaw;

  if (input.jump && player.grounded) {
    player.crouch = false;
    player.vel.y = JUMP_V;
    player.grounded = false;
  } else {
    player.vel.y -= GRAVITY * dt;
    if (player.vel.y < -18) player.vel.y = -18;
    if (player.grounded && player.vel.y < 0) player.vel.y = -3.2;
  }

  const beforeX = player.pos.x;
  const beforeZ = player.pos.z;
  player.grounded = moveWithCollision(player.pos, player.vel, PLAYER_RADIUS, playerHeight(player), dt, boxes);
  player.horizSpeed = Math.hypot(player.pos.x - beforeX, player.pos.z - beforeZ) / Math.max(dt, 0.0001);

  const wantsGrab = !player.crouch && !player.grounded && player.vel.y < 2.4 && player.vel.y > -7.5;
  if (wantsGrab) {
    const ledge = findLedge(player.pos, player.yaw, playerHeight(player), PLAYER_RADIUS, boxes);
    if (ledge && bodyClears(ledge.x, ledge.y, ledge.z, player, boxes)) {
      player.state = 'hang';
      player.hang = ledge;
      player.vel.set(0, 0, 0);
      player.pos.set(ledge.x, ledge.y, ledge.z);
    }
  }
}

function stepGrapple(player, dt, boxes) {
  const g = player.grapple;
  player.grappleTime += dt;
  const target = g.phase === 'out' ? g.approach : g.land;
  const dx = target.x - player.pos.x;
  const dy = target.y - player.pos.y;
  const dz = target.z - player.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.28) {
    if (g.phase === 'out') {
      g.phase = 'in';
      return;
    }
    const spot = nearestClear(g.land.x, g.land.y, g.land.z, PLAYER_RADIUS, playerHeight(player), boxes);
    player.pos.set(spot.x, spot.y, spot.z);
    player.vel.set(0, -2.2, 0);
    player.state = 'move';
    player.grapple = null;
    player.grounded = true;
    return;
  }
  const step = Math.min(GRAPPLE_SPEED * dt, dist);
  player.pos.x += (dx / dist) * step;
  player.pos.y += (dy / dist) * step;
  player.pos.z += (dz / dist) * step;
  if (player.grappleTime > 5.5) {
    player.state = 'move';
    player.grapple = null;
    player.vel.y = -2;
  }
}

export function stepGuards(guards, players, dt, world) {
  const boxes = world.colliders;
  for (const guard of guards) {
    if (!guard.alive) continue;
    guard.shoutCd = Math.max(0, guard.shoutCd - dt);
    guard.strikeCd = Math.max(0, guard.strikeCd - dt);

    const sensed = senseFrame(guard, players, boxes, dt);
    guard.seeing = sensed.seeing;
    guard.hearing = sensed.hearing;

    if (sensed.focus) {
      guard.focusId = sensed.focus.id;
      guard.lastKnown.set(sensed.focus.pos.x, guard.floorY, sensed.focus.pos.z);
    }

    if (sensed.seeing) guard.loseSight = 0;
    else guard.loseSight += dt;

    if (!sensed.seeing && !sensed.hearing) {
      const decay = guard.state === 'chase' ? 0.015 : 0.11;
      guard.awareness = Math.max(0, guard.awareness - decay * dt);
    }

    const prev = guard.state;
    transitionGuard(guard, sensed);

    if (guard.state === 'chase' && prev !== 'chase' && guard.shoutCd <= 0) {
      disturb(guards, guard.lastKnown.x, guard.pos.y, guard.lastKnown.z, 11, 0.48, guard.id);
      guard.shoutCd = 5;
    }

    actGuard(guard, players, dt, boxes);
  }
}

function senseFrame(guard, players, boxes, dt) {
  let seeing = false;
  let hearing = false;
  let focus = null;
  let best = -1;
  const eyeY = guard.pos.y + 1.48;

  for (const player of players) {
    if (!player || !player.connected) continue;
    const dx = player.pos.x - guard.pos.x;
    const dz = player.pos.z - guard.pos.z;
    const chestY = player.pos.y + playerHeight(player) * 0.55;
    const dy = chestY - eyeY;
    const flat = Math.hypot(dx, dz);
    const dist = Math.hypot(flat, dy);
    const ang = Math.abs(angleDiff(guard.yaw, Math.atan2(dx, dz || 0.0001)));

    let see = dist < VIEW_RANGE && ang < VIEW_HALF;
    if (player.crouch && dist > 4.7) see = false;
    if (see) {
      see = segmentClear(guard.pos.x, eyeY, guard.pos.z, player.pos.x, chestY, player.pos.z, boxes, 0.28);
    }

    const moving = player.horizSpeed > 0.22 && player.state !== 'hang';
    const hearRadius = player.crouch ? 1.12 : 4.7;
    const hear = moving && dist < hearRadius;

    if (see) {
      seeing = true;
      const closeness = 1 - clamp(dist / VIEW_RANGE, 0, 1);
      let rate = 0.28 + closeness * 0.58;
      if (player.crouch) rate *= 0.33;
      if (player.horizSpeed < 0.22) rate *= 0.6;
      guard.awareness = Math.min(1.25, guard.awareness + rate * dt);
      const score = rate + closeness;
      if (score > best) {
        best = score;
        focus = player;
      }
    } else if (hear) {
      hearing = true;
      guard.awareness = Math.min(0.85, guard.awareness + 0.2 * dt);
      if (!focus) focus = player;
    }
  }

  return { seeing, hearing, focus };
}

function transitionGuard(guard, sensed) {
  if (guard.awareness >= 1 && sensed.seeing && guard.state !== 'chase') {
    guard.state = 'chase';
    guard.loseSight = 0;
    return;
  }
  if (guard.state === 'patrol' && guard.awareness > 0.28) {
    guard.state = 'suspicious';
  }
  if (guard.state === 'suspicious' && !sensed.seeing && !sensed.hearing && guard.loseSight > 1.25) {
    guard.state = 'search';
    guard.searchTime = 0;
  }
  if (guard.state === 'chase' && !sensed.seeing && guard.loseSight > 3.1) {
    guard.state = 'search';
    guard.searchTime = 0;
    guard.awareness = Math.min(guard.awareness, 0.7);
  }
  if (guard.state === 'search' && sensed.seeing && guard.awareness > 0.35) {
    guard.state = 'suspicious';
  }
}

function actGuard(guard, players, dt, boxes) {
  if (guard.state === 'patrol') {
    followRoute(guard, guard.speed, dt, boxes);
    return;
  }

  const focus = players.find((p) => p && p.id === guard.focusId && p.connected);

  if (guard.state === 'suspicious') {
    if (!guard.roam) {
      if (focus) face(guard, focus.pos.x, focus.pos.z);
      else followRoute(guard, guard.speed * 0.85, dt, boxes);
      return;
    }
    if (guard.seeing && focus) {
      face(guard, focus.pos.x, focus.pos.z);
      guard.wait = 0.2;
    } else {
      moveToward(guard, guard.lastKnown.x, guard.lastKnown.z, guard.speed * 0.72, dt, boxes);
    }
    return;
  }

  if (guard.state === 'chase') {
    if (guard.pacifist) {
      if (focus) flee(guard, focus, dt, boxes);
      else followRoute(guard, guard.speed, dt, boxes);
      return;
    }
    if (!guard.roam) {
      if (guard.seeing && focus) face(guard, focus.pos.x, focus.pos.z);
      else followRoute(guard, guard.speed * 1.15, dt, boxes);
      return;
    }
    const dest = focus && Math.abs(focus.pos.y - guard.floorY) < 2.1 ? focus.pos : guard.lastKnown;
    moveToward(guard, dest.x, dest.z, guard.chaseSpeed, dt, boxes);
    return;
  }

  if (guard.state === 'search') {
    guard.searchTime += dt;
    if (!guard.roam) {
      guard.yaw += dt * 0.85;
      if (guard.searchTime > 3.8) beginReturn(guard);
      return;
    }
    const dist = moveToward(guard, guard.lastKnown.x, guard.lastKnown.z, guard.speed * 1.15, dt, boxes);
    if (dist < 0.55) {
      guard.yaw += dt * 0.9;
      if (guard.searchTime > 3.6) beginReturn(guard);
    } else if (guard.searchTime > 8) {
      beginReturn(guard);
    }
    return;
  }

  if (guard.state === 'return') {
    const point = guard.points[guard.wp];
    const dist = moveToward(guard, point.x, point.z, guard.speed, dt, boxes);
    if (dist < 0.35) {
      guard.state = 'patrol';
      guard.awareness = 0;
      guard.focusId = null;
      guard.wait = 0.3;
    }
  }
}

function beginReturn(guard) {
  let best = 0;
  let bestD = Infinity;
  guard.points.forEach((point, index) => {
    const d = Math.hypot(point.x - guard.pos.x, point.z - guard.pos.z);
    if (d < bestD) {
      bestD = d;
      best = index;
    }
  });
  guard.wp = best;
  guard.state = 'return';
}

function followRoute(guard, speed, dt, boxes) {
  const point = guard.points[guard.wp];
  const dist = Math.hypot(point.x - guard.pos.x, point.z - guard.pos.z);
  if (dist < 0.2) {
    guard.wait -= dt;
    if (guard.wait <= 0) {
      guard.wp = (guard.wp + 1) % guard.points.length;
      guard.wait = guard.pause;
    }
    return;
  }
  moveToward(guard, point.x, point.z, speed, dt, boxes);
}

function moveToward(guard, x, z, speed, dt, boxes) {
  const dx = x - guard.pos.x;
  const dz = z - guard.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.04) return dist;
  face(guard, x, z);
  const step = Math.min(dist, speed * dt);
  tryMove(guard, (dx / dist) * step, (dz / dist) * step, boxes);
  return Math.hypot(x - guard.pos.x, z - guard.pos.z);
}

function flee(guard, player, dt, boxes) {
  let dx = guard.pos.x - player.pos.x;
  let dz = guard.pos.z - player.pos.z;
  const dist = Math.hypot(dx, dz) || 1;
  dx /= dist;
  dz /= dist;
  face(guard, player.pos.x, player.pos.z);
  tryMove(guard, dx * guard.chaseSpeed * dt, dz * guard.chaseSpeed * dt, boxes);
}

function face(guard, x, z) {
  guard.yaw = Math.atan2(x - guard.pos.x, z - guard.pos.z);
}

function tryMove(guard, dx, dz, boxes) {
  if (!guard.roam) {
    guard.pos.x += dx;
    guard.pos.z += dz;
    guard.pos.y = guard.floorY;
    return;
  }
  const radius = 0.34;
  const height = 1.62;
  guard.pos.x += dx;
  if (anyOverlap(guard.pos.x, guard.pos.y, guard.pos.z, radius, height, boxes)) guard.pos.x -= dx;
  guard.pos.z += dz;
  if (anyOverlap(guard.pos.x, guard.pos.y, guard.pos.z, radius, height, boxes)) guard.pos.z -= dz;
  guard.pos.y = guard.floorY;
}

export function threaten(guards, player) {
  if (!player || player.strikeLock > 0) return false;
  if (player.state === 'takedown' || player.state === 'grapple' || player.state === 'pullup') return false;
  for (const guard of guards) {
    if (!guard.alive || guard.pacifist) continue;
    if (guard.state !== 'chase' || guard.focusId !== player.id) continue;
    if (Math.abs(player.pos.y - guard.pos.y) > 1.15) continue;
    const dx = player.pos.x - guard.pos.x;
    const dz = player.pos.z - guard.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1.05 || dist < 0.001) continue;
    player.vel.x += (dx / dist) * 5.2;
    player.vel.z += (dz / dist) * 5.2;
    player.vel.y = Math.max(player.vel.y, 2.1);
    player.strikeLock = 0.7;
    player.grounded = false;
    if (player.state === 'hang') {
      player.state = 'move';
      player.hang = null;
    }
    return true;
  }
  return false;
}

export function disturb(guards, x, y, z, radius, amount, exceptId) {
  for (const guard of guards) {
    if (!guard.alive || guard.id === exceptId) continue;
    const d = Math.hypot(guard.pos.x - x, guard.pos.y - y, guard.pos.z - z);
    if (d > radius) continue;
    guard.awareness = Math.min(1.05, guard.awareness + amount * (1 - d / radius));
    guard.lastKnown.set(x, guard.floorY, z);
    if (guard.state === 'patrol' || guard.state === 'return') guard.state = 'suspicious';
  }
}

export function canTakedown(player, guard, range = TAKEDOWN_RANGE) {
  if (!guard?.alive) return false;
  if (player.state !== 'move') return false;
  if (!player.grounded) return false;
  if (player.strikeLock > 0) return false;
  const dx = guard.pos.x - player.pos.x;
  const dy = guard.pos.y - player.pos.y;
  const dz = guard.pos.z - player.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > range || dist < 0.08) return false;
  if (Math.abs(dy) > 0.85) return false;
  const behind = (Math.sin(guard.yaw) * (player.pos.x - guard.pos.x) + Math.cos(guard.yaw) * (player.pos.z - guard.pos.z)) / dist;
  if (behind > -0.42) return false;
  const facing = (Math.sin(player.yaw) * dx + Math.cos(player.yaw) * dz) / dist;
  if (facing < 0.18) return false;
  if (guard.state === 'chase' && guard.focusId === player.id) return false;
  return true;
}

export function findTakedown(player, guards, range = TAKEDOWN_RANGE) {
  let best = null;
  let bestDist = range;
  for (const guard of guards) {
    if (!canTakedown(player, guard, bestDist)) continue;
    const dist = Math.hypot(guard.pos.x - player.pos.x, guard.pos.z - player.pos.z);
    if (dist <= bestDist) {
      best = guard;
      bestDist = dist;
    }
  }
  return best;
}

export function lungeAt(player, guard) {
  const fx = Math.sin(player.yaw);
  const fz = Math.cos(player.yaw);
  player.state = 'takedown';
  player.vel.set(0, 0, 0);
  player.takedown = {
    t: 0,
    dur: 0.46,
    from: player.pos.clone(),
    to: new THREE.Vector3(guard.pos.x - fx * 0.46, player.pos.y, guard.pos.z - fz * 0.46),
  };
}

export function beginTakedown(player, guard, guards, animatePlayer = true) {
  const awareOfMe = guard.focusId === player.id && guard.awareness > 0.34;
  const loud = !player.crouch || awareOfMe || guard.state === 'chase';
  const spot = { x: guard.pos.x, y: guard.pos.y, z: guard.pos.z };
  guard.alive = false;
  guard.state = 'down';
  if (animatePlayer) lungeAt(player, guard);
  if (loud) disturb(guards, spot.x, spot.y, spot.z, 8.5, 0.72, guard.id);
  return { loud };
}

export function measureExposure(player, guards, boxes) {
  let max = 0;
  let alert = 'unseen';
  const eyeCheck = senseExposure(player, guards, boxes);
  max = eyeCheck.max;
  alert = eyeCheck.alert;
  player.exposure = max;
  player.alert = alert;
  return alert;
}

function senseExposure(player, guards, boxes) {
  let max = 0;
  let alert = 'unseen';
  for (const guard of guards) {
    if (!guard.alive) continue;
    const chasingMe = guard.state === 'chase' && guard.focusId === player.id;
    const focused = guard.focusId === player.id;
    if (chasingMe) {
      alert = 'hunted';
      max = Math.max(max, 1);
      continue;
    }
    if (focused || guard.seeing) {
      max = Math.max(max, guard.awareness);
    }
    const dx = player.pos.x - guard.pos.x;
    const dz = player.pos.z - guard.pos.z;
    const dist = Math.hypot(dx, dz, player.pos.y - guard.pos.y);
    const ang = Math.abs(angleDiff(guard.yaw, Math.atan2(dx, dz || 0.0001)));
    if (ang < VIEW_HALF && dist < VIEW_RANGE && guard.awareness > 0.2) {
      max = Math.max(max, guard.awareness);
    }
  }
  if (alert !== 'hunted') {
    if (max >= 1) alert = 'hunted';
    else if (max > 0.28) alert = 'suspicious';
    else if (max > 0.06) alert = 'noticed';
    else alert = 'unseen';
  }
  return { max, alert };
}

export function stepMission(mission, players, guards, extract) {
  const target = guards.find((g) => g.isTarget);
  const wasDown = mission.targetDown;
  mission.targetDown = !!(target && !target.alive);
  const active = players.filter((p) => p && p.connected);
  const atFord = active.filter((p) => {
    if (p.state === 'grapple') return false;
    return Math.hypot(p.pos.x - extract.x, p.pos.z - extract.z) <= extract.r && Math.abs(p.pos.y - extract.y) < 1.5;
  });
  mission.atFord = atFord.map((p) => p.id);
  mission.need = active.length;
  if (!mission.won && mission.targetDown && active.length > 0 && atFord.length === active.length) {
    mission.won = true;
  }
  return { justDown: mission.targetDown && !wasDown };
}

export function emptyMission() {
  return { targetDown: false, won: false, atFord: [], need: 1 };
}
