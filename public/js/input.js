import { clamp } from './geom.js';

export function attachInput(canvas) {
  const look = { yaw: 0.4, pitch: 0.18 };
  const edges = { jump: false, crouchToggle: false, grapple: false, act: false };
  const keys = new Set();
  let touchUsed = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lookTouch = null;
  const stickOut = { x: 0, y: 0 };

  const keyMap = {
    KeyW: 'f',
    KeyS: 'b',
    KeyA: 'l',
    KeyD: 'r',
    ArrowUp: 'f',
    ArrowDown: 'b',
    ArrowLeft: 'l',
    ArrowRight: 'r',
  };

  window.addEventListener('keydown', (event) => {
    if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA')) return;
    if (event.repeat && (event.code === 'KeyC' || event.code === 'Space' || event.code === 'KeyF' || event.code === 'KeyE')) {
      if (event.code === 'Space') event.preventDefault();
      return;
    }
    if (event.code === 'KeyC' || event.code === 'ControlLeft') edges.crouchToggle = true;
    else if (event.code === 'Space') {
      edges.jump = true;
      event.preventDefault();
    } else if (event.code === 'KeyF') edges.grapple = true;
    else if (event.code === 'KeyE') edges.act = true;
    else if (keyMap[event.code]) keys.add(keyMap[event.code]);
  });

  window.addEventListener('keyup', (event) => {
    const mapped = keyMap[event.code];
    if (mapped) keys.delete(mapped);
  });

  window.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === canvas) {
      look.yaw += event.movementX * 0.00215;
      look.pitch = clamp(look.pitch - event.movementY * 0.0018, -0.62, 1.02);
    } else if (dragging) {
      look.yaw += (event.clientX - lastX) * 0.0052;
      look.pitch = clamp(look.pitch - (event.clientY - lastY) * 0.004, -0.62, 1.02);
      lastX = event.clientX;
      lastY = event.clientY;
    }
  });

  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
  });

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  canvas.addEventListener('touchstart', (event) => {
    touchUsed = true;
    for (const touch of event.changedTouches) {
      if (!lookTouch && touch.clientX > window.innerWidth * 0.4) {
        lookTouch = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
      }
    }
    event.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', (event) => {
    if (!lookTouch) return;
    for (const touch of event.changedTouches) {
      if (touch.identifier !== lookTouch.id) continue;
      look.yaw += (touch.clientX - lookTouch.x) * 0.0058;
      look.pitch = clamp(look.pitch - (touch.clientY - lookTouch.y) * 0.0046, -0.62, 1.02);
      lookTouch.x = touch.clientX;
      lookTouch.y = touch.clientY;
    }
    event.preventDefault();
  }, { passive: false });

  const endLook = (event) => {
    for (const touch of event.changedTouches) {
      if (lookTouch && touch.identifier === lookTouch.id) lookTouch = null;
    }
  };
  canvas.addEventListener('touchend', endLook);
  canvas.addEventListener('touchcancel', endLook);

  function bindStick(el, knob) {
    let id = null;
    let originX = 0;
    let originY = 0;
    const max = 48;
    const start = (touch, event) => {
      touchUsed = true;
      id = touch.identifier;
      originX = touch.clientX;
      originY = touch.clientY;
      stickOut.x = 0;
      stickOut.y = 0;
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (touch) => {
      if (touch.identifier !== id) return;
      const dx = touch.clientX - originX;
      const dy = touch.clientY - originY;
      const len = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(max, len);
      const ux = dx / len;
      const uy = dy / len;
      stickOut.x = ux * (clamped / max);
      stickOut.y = -uy * (clamped / max);
      knob.style.transform = `translate(calc(-50% + ${ux * clamped}px), calc(-50% + ${uy * clamped}px))`;
    };
    const finish = (touch) => {
      if (touch.identifier !== id) return;
      id = null;
      stickOut.x = 0;
      stickOut.y = 0;
      knob.style.transform = 'translate(-50%, -50%)';
    };
    el.addEventListener('touchstart', (event) => start(event.changedTouches[0], event), { passive: false });
    el.addEventListener('touchmove', (event) => {
      for (const touch of event.changedTouches) move(touch);
      event.preventDefault();
    }, { passive: false });
    el.addEventListener('touchend', (event) => {
      for (const touch of event.changedTouches) finish(touch);
    });
    el.addEventListener('touchcancel', (event) => {
      for (const touch of event.changedTouches) finish(touch);
    });
  }

  function bindEdge(el, key) {
    const fire = (event) => {
      touchUsed = true;
      edges[key] = true;
      event.preventDefault();
      event.stopPropagation();
    };
    el.addEventListener('touchstart', fire, { passive: false });
  }

  function read() {
    let moveX = 0;
    let moveZ = 0;
    if (keys.has('r')) moveX += 1;
    if (keys.has('l')) moveX -= 1;
    if (keys.has('f')) moveZ += 1;
    if (keys.has('b')) moveZ -= 1;
    moveX = clamp(moveX + stickOut.x, -1, 1);
    moveZ = clamp(moveZ + stickOut.y, -1, 1);
    const sample = {
      moveX,
      moveZ,
      jump: edges.jump,
      crouchToggle: edges.crouchToggle,
      grapple: edges.grapple,
      act: edges.act,
      camYaw: look.yaw,
      camPitch: look.pitch,
    };
    edges.jump = false;
    edges.crouchToggle = false;
    edges.grapple = false;
    edges.act = false;
    return sample;
  }

  return {
    look,
    read,
    bindStick,
    bindEdge,
    usedTouch: () => touchUsed,
    requestLock() {
      if (touchUsed) return;
      if (canvas.requestPointerLock) canvas.requestPointerLock();
    },
  };
}
