// Plain collision helpers. Gameplay colliders are axis-aligned boxes.
// blocksMove / blocksSight default to true.

export function blocksMove(box) {
  return box.blocksMove !== false;
}

export function blocksSight(box) {
  return box.blocksSight !== false;
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function overlapAABB(px, py, pz, radius, height, box) {
  if (!blocksMove(box)) return false;
  return (
    px + radius > box.minX &&
    px - radius < box.maxX &&
    py + height > box.minY &&
    py < box.maxY - 0.001 &&
    pz + radius > box.minZ &&
    pz - radius < box.maxZ
  );
}

export function anyOverlap(px, py, pz, radius, height, boxes) {
  for (const box of boxes) {
    if (overlapAABB(px, py, pz, radius, height, box)) return true;
  }
  return false;
}

export function rayBox(ox, oy, oz, dx, dy, dz, maxDist, box) {
  let tmin = 0;
  let tmax = maxDist;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const origin = [ox, oy, oz];
  const dir = [dx, dy, dz];
  const min = [box.minX, box.minY, box.minZ];
  const max = [box.maxX, box.maxY, box.maxZ];

  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-8) {
      if (origin[i] < min[i] || origin[i] > max[i]) return null;
      continue;
    }
    let t1 = (min[i] - origin[i]) / dir[i];
    let t2 = (max[i] - origin[i]) / dir[i];
    let sign = -1;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = 0;
      nz = 0;
      if (i === 0) nx = sign;
      else if (i === 1) ny = sign;
      else nz = sign;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (tmin <= 0.0008 || tmin > maxDist) return null;
  return {
    t: tmin,
    x: ox + dx * tmin,
    y: oy + dy * tmin,
    z: oz + dz * tmin,
    nx,
    ny,
    nz,
    box,
  };
}

export function raycast(ox, oy, oz, dx, dy, dz, maxDist, boxes, pred) {
  let best = null;
  for (const box of boxes) {
    if (pred && !pred(box)) continue;
    const hit = rayBox(ox, oy, oz, dx, dy, dz, maxDist, box);
    if (hit && (!best || hit.t < best.t)) best = hit;
  }
  return best;
}

export function segmentClear(ax, ay, az, bx, by, bz, boxes, endPad = 0.2, pred = blocksSight) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.08) return true;
  const hit = raycast(ax, ay, az, dx / dist, dy / dist, dz / dist, Math.max(0, dist - endPad), boxes, pred);
  return !hit;
}

const STEP = 0.46;

/**
 * Move a feet-positioned body. `vel` is meters/second and is mutated when blocked.
 * Returns whether the body is standing on something.
 */
export function moveWithCollision(pos, vel, radius, height, dt, boxes) {
  let grounded = false;
  if (vel.x) {
    pos.x += vel.x * dt;
    resolveHorizontal('x');
  }
  if (vel.z) {
    pos.z += vel.z * dt;
    resolveHorizontal('z');
  }
  pos.y += vel.y * dt;
  for (let pass = 0; pass < 4; pass++) {
    let hit = false;
    for (const box of boxes) {
      if (!overlapAABB(pos.x, pos.y, pos.z, radius, height, box)) continue;
      hit = true;
      if (vel.y > 0) {
        pos.y = box.minY - height - 0.001;
        vel.y = 0;
      } else {
        pos.y = box.maxY;
        vel.y = 0;
        grounded = true;
      }
    }
    if (!hit) break;
  }
  if (pos.y <= 0) {
    pos.y = 0;
    if (vel.y < 0) vel.y = 0;
    grounded = true;
  }
  return grounded;

  function resolveHorizontal(axis) {
    const delta = vel[axis];
    for (let pass = 0; pass < 4; pass++) {
      const hits = [];
      for (const box of boxes) {
        if (overlapAABB(pos.x, pos.y, pos.z, radius, height, box)) hits.push(box);
      }
      if (!hits.length) return;

      let stepped = false;
      let lowest = Infinity;
      for (const box of hits) {
        const rise = box.maxY - pos.y;
        if (rise > 0.02 && rise <= STEP && box.maxY < lowest) lowest = box.maxY;
      }
      if (lowest < Infinity) {
        const oldY = pos.y;
        pos.y = lowest;
        if (!anyOverlap(pos.x, pos.y, pos.z, radius, height, boxes)) {
          stepped = true;
          return;
        }
        pos.y = oldY;
      }
      if (stepped) return;

      let best = null;
      let bestPen = -1;
      for (const box of hits) {
        const pen = axis === 'x'
          ? (delta > 0 ? pos.x + radius - box.minX : box.maxX - (pos.x - radius))
          : (delta > 0 ? pos.z + radius - box.minZ : box.maxZ - (pos.z - radius));
        if (pen > bestPen) {
          bestPen = pen;
          best = box;
        }
      }
      if (!best || bestPen <= 0) return;
      if (axis === 'x') {
        pos.x = delta > 0 ? best.minX - radius - 0.001 : best.maxX + radius + 0.001;
        vel.x = 0;
      } else {
        pos.z = delta > 0 ? best.minZ - radius - 0.001 : best.maxZ + radius + 0.001;
        vel.z = 0;
      }
    }
  }
}

export function findLedge(pos, yaw, height, radius, boxes) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const chestY = pos.y + Math.min(height * 0.62, height - 0.2);
  const wall = raycast(pos.x, chestY, pos.z, fx, 0, fz, 0.78, boxes, blocksMove);
  if (!wall || Math.abs(wall.ny) > 0.45) return null;

  for (const dist of [0.34, 0.52, 0.74]) {
    const sx = pos.x + fx * dist;
    const sz = pos.z + fz * dist;
    const down = raycast(sx, pos.y + height + 1.5, sz, 0, -1, 0, height + 1.6, boxes, blocksMove);
    if (!down || down.ny < 0.65) continue;
    if (Math.hypot(down.x - wall.x, down.z - wall.z) > 0.95) continue;
    const lipY = down.y;
    const rel = lipY - pos.y;
    if (rel < 0.82 || rel > height + 0.4) continue;
    const hx = wall.x - fx * (radius + 0.06);
    const hz = wall.z - fz * (radius + 0.06);
    const hy = Math.max(0, lipY - height * 0.9);
    if (anyOverlap(hx, hy + 0.03, hz, radius * 0.9, Math.min(height, Math.max(0.9, lipY - hy - 0.05)), boxes)) continue;
    return { lipY, x: hx, y: hy, z: hz, fx, fz, hitX: down.x, hitZ: down.z };
  }
  return null;
}

export function nearestClear(x, y, z, radius, height, boxes) {
  const tries = [
    [0, 0, 0],
    [0, 0.08, 0],
    [0.35, 0.02, 0],
    [-0.35, 0.02, 0],
    [0, 0.02, 0.35],
    [0, 0.02, -0.35],
    [0.5, 0.05, 0.2],
    [-0.2, 0.05, 0.5],
  ];
  for (const [ox, oy, oz] of tries) {
    if (!anyOverlap(x + ox, y + oy, z + oz, radius, height, boxes)) {
      return { x: x + ox, y: y + oy, z: z + oz };
    }
  }
  return { x, y: y + 0.15, z };
}
