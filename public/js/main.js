import * as THREE from 'three';
import { createGuardView, createPlayerView, makeRope, pulseHooks, syncGuard, syncPlayer, updateRope } from './actors.js';
import { angleDiff, blocksMove, raycast } from './geom.js';
import { attachInput } from './input.js';
import { connectNet } from './net.js';
import {
  beginTakedown,
  canTakedown,
  emptyMission,
  findTakedown,
  lungeAt,
  makeGuard,
  makePlayer,
  measureExposure,
  stepGuards,
  stepMission,
  stepPlayer,
  threaten,
} from './sim.js';
import { HAMLET_NAME, buildWorld } from './world.js';

const canvas = document.getElementById('view');
const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const touch = document.getElementById('touch');
const objectiveEl = document.getElementById('objective');
const detailEl = document.getElementById('objective-detail');
const alertLabel = document.getElementById('alert-label');
const meterFill = document.getElementById('meter-fill');
const roomPill = document.getElementById('room-pill');
const promptEl = document.getElementById('prompt');
const toastEl = document.getElementById('toast');
const winEl = document.getElementById('win');
const reticle = document.getElementById('reticle');
const menuError = document.getElementById('menu-error');
const menuStatus = document.getElementById('menu-status');
const codeInput = document.getElementById('code');
const btnCrouch = document.getElementById('btn-crouch');
const btnHook = document.getElementById('btn-hook');
const btnDown = document.getElementById('btn-down');
const btnRise = document.getElementById('btn-rise');
const debugEl = document.getElementById('debug');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x141318);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x17161c);
scene.fog = new THREE.Fog(0x17161c, 22, 64);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.08, 90);

scene.add(new THREE.HemisphereLight(0xa8b4c8, 0x4a382c, 1.05));
scene.add(new THREE.AmbientLight(0x3c4154, 0.72));
const sun = new THREE.DirectionalLight(0xe4e7f4, 1.25);
sun.position.set(-18, 26, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 72;
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.bias = -0.00035;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight(0xffc7a2, 0.28);
fill.position.set(14, 8, -8);
scene.add(fill);

const moon = new THREE.Mesh(
  new THREE.SphereGeometry(2.4, 14, 10),
  new THREE.MeshBasicMaterial({ color: 0xe7e2d4 }),
);
moon.position.set(-28, 26, -16);
moon.name = 'moon';
scene.add(moon);

const world = buildWorld(scene);
const guards = world.patrols.map((def) => makeGuard(def));
const guardViews = new Map(guards.map((guard) => [guard.id, createGuardView(scene, guard)]));
const rope = makeRope(scene);

const input = attachInput(canvas);
input.bindStick(document.getElementById('stick'), document.getElementById('knob'));
input.bindEdge(btnCrouch, 'crouchToggle');
input.bindEdge(btnHook, 'grapple');
input.bindEdge(btnDown, 'act');
input.bindEdge(btnRise, 'jump');

const net = connectNet();
const focus = new THREE.Vector3();
const aimDir = new THREE.Vector3();
const camTarget = new THREE.Vector3();

let role = null;
let playing = false;
let local = null;
let remote = null;
let mission = emptyMission();
let roomCode = '';
let snapAcc = 0;
let sendAcc = 0;
let toast = '';
let toastUntil = 0;
let showDebug = false;
let audioCtx = null;
const names = { p1: 'Sable', p2: 'Cinder' };
const colors = { p1: 0x2c3a62, p2: 0x6e2e38 };

const coarse = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 860;
if (coarse) touch.classList.add('show');

function blip(freq, dur, type, gain) {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const amp = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.value = gain;
    amp.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.connect(amp);
    amp.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch {
    /* audio is optional */
  }
}

function say(text, seconds = 2.4) {
  toast = text;
  toastUntil = performance.now() + seconds * 1000;
}

const shoulder = new THREE.Vector3();
const lookPoint = new THREE.Vector3();

function placeCamera(player, dt, snap) {
  const head = player.crouch ? 1.02 : 1.4;
  const yaw = player.camYaw;
  const pitch = player.camPitch;
  const cp = Math.cos(pitch);
  aimDir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
  shoulder.set(Math.cos(yaw), 0, -Math.sin(yaw));
  focus.set(player.pos.x, player.pos.y + head, player.pos.z);
  const dist = 4.55 + Math.max(0, pitch) * 1.35;
  camTarget.copy(focus).addScaledVector(aimDir, -dist).addScaledVector(shoulder, 0.72);
  camTarget.y += 0.28;
  const toCamX = camTarget.x - focus.x;
  const toCamY = camTarget.y - focus.y;
  const toCamZ = camTarget.z - focus.z;
  const toCamLen = Math.hypot(toCamX, toCamY, toCamZ) || 1;
  const hit = raycast(
    focus.x,
    focus.y,
    focus.z,
    toCamX / toCamLen,
    toCamY / toCamLen,
    toCamZ / toCamLen,
    toCamLen,
    world.colliders,
    blocksMove,
  );
  if (hit && hit.t > 0.45) {
    const pull = Math.max(0.55, hit.t - 0.28);
    camTarget.set(
      focus.x + (toCamX / toCamLen) * pull,
      focus.y + (toCamY / toCamLen) * pull,
      focus.z + (toCamZ / toCamLen) * pull,
    );
  }
  if (snap) camera.position.copy(camTarget);
  else camera.position.lerp(camTarget, 1 - Math.exp(-16 * dt));
  lookPoint.copy(focus).addScaledVector(aimDir, 6);
  camera.lookAt(lookPoint);
}

function activePlayers() {
  const list = [];
  if (local) list.push(local);
  if (remote?.connected) list.push(remote);
  return list;
}

function packPlayer(player) {
  return {
    id: player.id,
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z,
    yaw: player.yaw,
    crouch: player.crouch,
    state: player.state,
    speed: player.horizSpeed,
  };
}

function ensureRemote(id) {
  if (remote && remote.id === id) return remote;
  remote = makePlayer(id, names[id], world.spawns[id]);
  remote.connected = false;
  remote.view = createPlayerView(scene, id === 'p1' ? 'playerA' : 'playerB', names[id], colors[id]);
  remote.view.root.visible = false;
  remote.draw = remote.pos.clone();
  return remote;
}

function startMatch(welcome) {
  role = welcome.role;
  playing = true;
  roomCode = welcome.code;
  mission = emptyMission();
  const spawn = world.spawns[welcome.id];
  local = makePlayer(welcome.id, welcome.name, spawn);
  local.view = createPlayerView(
    scene,
    welcome.id === 'p1' ? 'playerA' : 'playerB',
    welcome.name,
    colors[welcome.id],
  );
  local.view.label.visible = false;
  input.look.yaw = spawn.yaw;
  input.look.pitch = 0.2;
  local.camYaw = spawn.yaw;
  local.camPitch = 0.2;
  if (!remote) ensureRemote(welcome.id === 'p1' ? 'p2' : 'p1');
  if (role === 'guest') remote.connected = false;
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  document.body.classList.add('playing');
  placeCamera(local, 0.016, true);
  say(welcome.id === 'p1' ? 'Sable is in the yard.' : 'Cinder is in the yard.', 2.2);
}

function acceptGuest(msg) {
  const body = ensureRemote('p2');
  const next = new THREE.Vector3(msg.x, msg.y, msg.z);
  if (!body.connected) {
    body.pos.copy(next);
    body.draw.copy(next);
  } else {
    const dist = body.pos.distanceTo(next);
    const allow = msg.state === 'grapple' ? 14 : 8;
    if (dist < allow || dist > 30) body.pos.copy(next);
    else body.pos.lerp(next, allow / dist);
  }
  body.yaw = msg.yaw;
  body.crouch = !!msg.crouch;
  body.state = msg.state || 'move';
  body.horizSpeed = msg.speed || 0;
  body.grounded = body.state === 'move';
  body.connected = true;
  body.view.root.visible = true;
}

function applySnap(msg) {
  if (!msg.guards) return;
  for (const packed of msg.guards) {
    const guard = guards.find((item) => item.id === packed.id);
    if (!guard) continue;
    if (guard.tx == null) guard.pos.set(packed.x, packed.y, packed.z);
    guard.tx = packed.x;
    guard.ty = packed.y;
    guard.tz = packed.z;
    guard.targetYaw = packed.yaw;
    guard.state = packed.state;
    guard.awareness = packed.aw;
    guard.focusId = packed.focus;
    guard.alive = !!packed.alive;
  }
  for (const packed of msg.players || []) {
    if (local && packed.id === local.id) continue;
    const body = ensureRemote(packed.id);
    if (body.tx == null) {
      body.pos.set(packed.x, packed.y, packed.z);
      body.draw.copy(body.pos);
    }
    body.tx = packed.x;
    body.ty = packed.y;
    body.tz = packed.z;
    body.yaw = packed.yaw;
    body.crouch = !!packed.crouch;
    body.state = packed.state;
    body.horizSpeed = packed.speed || 0;
    body.connected = true;
    body.view.root.visible = true;
  }
  if (msg.mission) {
    const was = mission.targetDown;
    mission.targetDown = !!msg.mission.targetDown;
    mission.won = !!msg.mission.won;
    mission.atFord = msg.mission.atFord || [];
    mission.need = msg.mission.need || 1;
    if (mission.targetDown && !was) {
      say('Voss is down. Reach the south ford.');
      blip(90, 0.2, 'sine', 0.06);
    }
  }
}

function interpolateRemote(dt) {
  const k = 1 - Math.exp(-12 * dt);
  for (const guard of guards) {
    if (guard.tx == null) continue;
    guard.pos.x += (guard.tx - guard.pos.x) * k;
    guard.pos.y += (guard.ty - guard.pos.y) * k;
    guard.pos.z += (guard.tz - guard.pos.z) * k;
    if (guard.targetYaw != null) guard.yaw += angleDiff(guard.targetYaw, guard.yaw) * k;
  }
  if (remote?.connected && remote.tx != null) {
    remote.pos.x += (remote.tx - remote.pos.x) * k;
    remote.pos.y += (remote.ty - remote.pos.y) * k;
    remote.pos.z += (remote.tz - remote.pos.z) * k;
  }
}

net.onStatus((open) => {
  menuStatus.textContent = open ? 'Ready to move.' : 'Connecting…';
});

net.onMessage((msg) => {
  if (msg.type === 'welcome') {
    menuError.textContent = '';
    startMatch(msg);
    return;
  }
  if (msg.type === 'error') {
    menuError.textContent = msg.error || 'Could not join.';
    return;
  }
  if (msg.type === 'peer') {
    const body = ensureRemote(msg.id);
    body.connected = !!msg.joined;
    if (body.view) body.view.root.visible = !!msg.joined;
    if (msg.joined) say('Cinder has entered the hamlet.');
    else say('Cinder left the mission.');
    return;
  }
  if (msg.type === 'guest' && role === 'host') {
    acceptGuest(msg);
    return;
  }
  if (msg.type === 'act' && role === 'host' && msg.act === 'takedown') {
    const body = ensureRemote('p2');
    body.pos.set(msg.x, msg.y, msg.z);
    body.yaw = msg.yaw;
    body.crouch = !!msg.crouch;
    body.grounded = true;
    body.state = 'move';
    body.connected = true;
    const guard = guards.find((item) => item.id === msg.guardId);
    if (guard && canTakedown(body, guard, 1.95)) {
      const result = beginTakedown(body, guard, guards, false);
      if (result.loud) say('That was heard.');
    }
    return;
  }
  if (msg.type === 'snap' && role === 'guest') {
    applySnap(msg);
    return;
  }
  if (msg.type === 'hostleft') {
    say('The host left. The mission ends.');
    playing = false;
  }
  if (msg.type === 'closed' && playing) {
    say('Connection lost.');
  }
});

document.getElementById('btn-host').addEventListener('click', () => {
  menuError.textContent = '';
  if (!net.connected) {
    menuError.textContent = 'Still connecting. Try again in a moment.';
    return;
  }
  net.send({ type: 'host' });
});

document.getElementById('btn-join').addEventListener('click', () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length < 4) {
    menuError.textContent = 'Enter the four-character code.';
    return;
  }
  if (!net.connected) {
    menuError.textContent = 'Still connecting. Try again in a moment.';
    return;
  }
  net.send({ type: 'join', code });
});

codeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.getElementById('btn-join').click();
});

canvas.addEventListener('click', () => {
  if (playing) input.requestLock();
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Backquote') showDebug = !showDebug;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (window.innerWidth < 860) touch.classList.add('show');
});

function updateHud(takedown, time) {
  const need = mission.need || 1;
  if (mission.won) {
    objectiveEl.textContent = 'The ford is clear';
    detailEl.textContent = need > 1
      ? 'Orchard Gate keeps the quiet. Both of you made it out.'
      : 'Orchard Gate keeps the quiet. You made it out.';
  } else if (mission.targetDown) {
    objectiveEl.textContent = need > 1 ? 'Both shinobi to the south ford' : 'Reach the south ford';
    const at = mission.atFord || [];
    if (need > 1) {
      const waiting = ['p1', 'p2'].filter((id) => {
        const active = id === local?.id || (remote?.connected && remote.id === id);
        return active && !at.includes(id);
      });
      detailEl.textContent = waiting.length
        ? `Still out: ${waiting.map((id) => names[id]).join(', ')}.`
        : 'Stand together on the ford.';
    } else {
      detailEl.textContent = 'The gate is south. The green ring is the ford.';
    }
  } else {
    objectiveEl.textContent = 'Silence Envoy Voss';
    detailEl.textContent = 'He walks the tall house with the red mark, east of the yard.';
  }

  const alert = local?.alert || 'unseen';
  const words = { unseen: 'Unseen', noticed: 'Noticed', suspicious: 'Suspicious', hunted: 'Hunted' };
  alertLabel.textContent = words[alert] || 'Unseen';
  alertLabel.dataset.level = alert;
  const fill = alert === 'hunted' ? 1 : Math.max(0, Math.min(1, local?.exposure || 0));
  meterFill.style.width = `${fill * 100}%`;
  meterFill.style.background = alert === 'hunted' ? 'var(--bad)' : alert === 'suspicious' || alert === 'noticed' ? 'var(--warn)' : 'var(--good)';

  roomPill.textContent = `${local?.name || ''}  ·  ${role === 'host' ? 'Host' : 'Join'}  ·  ${roomCode}`;

  let prompt = '';
  let hot = false;
  if (takedown) prompt = 'Silent takedown';
  else if (local?.aimHook && (local.state === 'move' || local.state === 'hang')) {
    prompt = 'Grapple';
    hot = true;
  } else if (local?.state === 'hang') prompt = 'Pull up    ·    Drop';
  promptEl.textContent = prompt;
  promptEl.classList.toggle('show', !!prompt);
  reticle.classList.toggle('hot', hot);
  reticle.classList.toggle('hidden', !playing);

  btnCrouch.classList.toggle('on', !!local?.crouch);
  btnHook.classList.toggle('ready', hot);
  btnDown.classList.toggle('ready', !!takedown);

  toastEl.textContent = time * 1000 < toastUntil ? toast : '';
  toastEl.classList.toggle('show', time * 1000 < toastUntil);
  winEl.classList.toggle('show', !!mission.won);
  if (input.usedTouch()) touch.classList.add('show');

  debugEl.classList.toggle('show', showDebug && !!local);
  if (showDebug && local) {
    const p = local.pos;
    debugEl.textContent = `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  ${local.state}  ${local.alert}`;
  }
}

let orbit = 0.6;
let last = performance.now();
let huntedBlip = false;

function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  const time = now / 1000;

  if (!playing || !local) {
    orbit += dt * 0.08;
    camera.position.set(Math.sin(orbit) * 24, 13.5, Math.cos(orbit) * 24);
    camera.lookAt(world.focus.x, world.focus.y, world.focus.z);
    for (const guard of guards) syncGuard(guard, guardViews.get(guard.id), dt);
    pulseHooks(world.hooks, time, null);
    if (world.extractRing) {
      const s = 1 + Math.sin(time * 2) * 0.05;
      world.extractRing.scale.setScalar(s);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }

  const sample = input.read();
  local.camYaw = sample.camYaw;
  local.camPitch = sample.camPitch;
  placeCamera(local, dt, false);
  const cp = Math.cos(sample.camPitch);
  aimDir.set(Math.sin(sample.camYaw) * cp, Math.sin(sample.camPitch), Math.cos(sample.camYaw) * cp);
  const aim = {
    origin: new THREE.Vector3(local.pos.x, local.pos.y + (local.crouch ? 0.85 : 1.3), local.pos.z),
    dir: aimDir.clone(),
  };

  const wasGrapple = local.state === 'grapple';
  const prevAlert = local.alert;
  stepPlayer(local, sample, dt, world, aim);
  if (!wasGrapple && local.state === 'grapple') blip(170, 0.12, 'triangle', 0.045);

  if (role === 'host') {
    const minds = activePlayers();
    stepGuards(guards, minds, dt, world);
    const result = stepMission(mission, minds, guards, world.extract);
    if (result.justDown) {
      say('Voss is down. Reach the south ford.');
      blip(90, 0.22, 'sine', 0.07);
    }
    snapAcc += dt;
    if (snapAcc >= 1 / 15) {
      snapAcc = 0;
      net.send({
        type: 'snap',
        players: minds.map(packPlayer),
        guards: guards.map((guard) => ({
          id: guard.id,
          x: guard.pos.x,
          y: guard.pos.y,
          z: guard.pos.z,
          yaw: guard.yaw,
          state: guard.state,
          aw: guard.awareness,
          alive: guard.alive,
          focus: guard.focusId,
        })),
        mission: {
          targetDown: mission.targetDown,
          won: mission.won,
          atFord: mission.atFord,
          need: mission.need,
        },
      });
    }
  } else {
    interpolateRemote(dt);
    sendAcc += dt;
    if (sendAcc >= 1 / 15) {
      sendAcc = 0;
      net.send({
        type: 'guest',
        x: local.pos.x,
        y: local.pos.y,
        z: local.pos.z,
        yaw: local.yaw,
        crouch: local.crouch,
        state: local.state,
        speed: local.horizSpeed,
      });
    }
  }

  const takedown = findTakedown(local, guards);
  if (sample.act && takedown && local.state === 'move') {
    if (role === 'host') {
      const result = beginTakedown(local, takedown, guards, true);
      blip(78, 0.16, 'sine', 0.08);
      if (result.loud) say('That was heard.');
    } else {
      lungeAt(local, takedown);
      blip(78, 0.16, 'sine', 0.08);
      net.send({
        type: 'act',
        act: 'takedown',
        guardId: takedown.id,
        x: local.pos.x,
        y: local.pos.y,
        z: local.pos.z,
        yaw: local.yaw,
        crouch: local.crouch,
      });
    }
  }

  if (threaten(guards, local)) blip(50, 0.12, 'square', 0.04);
  measureExposure(local, guards, world.colliders);
  if (local.alert === 'hunted' && prevAlert !== 'hunted' && !huntedBlip) {
    blip(230, 0.09, 'square', 0.03);
    huntedBlip = true;
  }
  if (local.alert !== 'hunted') huntedBlip = false;

  if (remote?.connected && remote !== local) {
    if (!remote.draw) remote.draw = remote.pos.clone();
    if (role === 'host') remote.draw.lerp(remote.pos, 1 - Math.exp(-14 * dt));
    else remote.draw.copy(remote.pos);
    syncPlayer(remote, dt);
  }
  local.draw = local.pos;
  syncPlayer(local, dt);
  for (const guard of guards) syncGuard(guard, guardViews.get(guard.id), dt);
  updateRope(rope, local);
  pulseHooks(world.hooks, time, local.aimHook?.id);
  if (world.extractRing) world.extractRing.scale.setScalar(1 + Math.sin(time * 2) * 0.05);

  placeCamera(local, dt, false);
  updateHud(takedown, time);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.shinzu = {
  scene,
  world,
  guards,
  camera,
  input,
  get player() {
    return local;
  },
  get mission() {
    return mission;
  },
  get role() {
    return role;
  },
  get remote() {
    return remote;
  },
};

requestAnimationFrame(frame);
