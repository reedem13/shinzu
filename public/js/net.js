export function connectNet() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let socket = null;
  let open = false;
  const listeners = new Set();
  const statusListeners = new Set();

  function emitStatus() {
    for (const fn of statusListeners) fn(open);
  }

  function connect() {
    socket = new WebSocket(`${proto}://${location.host}`);
    socket.addEventListener('open', () => {
      open = true;
      emitStatus();
    });
    socket.addEventListener('close', () => {
      open = false;
      emitStatus();
      for (const fn of listeners) fn({ type: 'closed' });
    });
    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      for (const fn of listeners) fn(msg);
    });
  }

  connect();

  return {
    send(obj) {
      if (socket && socket.readyState === 1) socket.send(JSON.stringify(obj));
    },
    onMessage(fn) {
      listeners.add(fn);
    },
    onStatus(fn) {
      statusListeners.add(fn);
      fn(open);
    },
    get connected() {
      return open;
    },
  };
}
