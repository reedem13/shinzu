import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 43123;
const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const rooms = new Map();

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 24; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += alphabet[(Math.random() * alphabet.length) | 0];
    if (!rooms.has(code)) return code;
  }
  return `Z${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

function send(socket, obj) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(obj));
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeFile(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const full = path.normalize(path.join(root, decoded));
  if (!full.startsWith(root)) return null;
  return full;
}

function serveFile(res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '') {
    serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }
  if (urlPath.startsWith('/vendor/three/')) {
    const rel = urlPath.slice('/vendor/three/'.length);
    const file = safeFile(THREE_DIR, rel);
    if (!file) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    serveFile(res, file);
    return;
  }
  const file = safeFile(PUBLIC_DIR, urlPath);
  if (!file) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  serveFile(res, file);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => {
    ws.alive = true;
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'host' && !ws.room) {
      const code = makeCode();
      const room = { code, host: ws, guest: null, lastSnap: null };
      rooms.set(code, room);
      ws.role = 'host';
      ws.id = 'p1';
      ws.room = room;
      send(ws, { type: 'welcome', role: 'host', id: 'p1', code, name: 'Sable' });
      return;
    }

    if (msg.type === 'join' && !ws.room) {
      const code = String(msg.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room || !room.host || room.host.readyState !== 1) {
        send(ws, { type: 'error', error: 'No mission uses that code.' });
        return;
      }
      if (room.guest && room.guest.readyState === 1) {
        send(ws, { type: 'error', error: 'That mission already has two shinobi.' });
        return;
      }
      room.guest = ws;
      ws.role = 'guest';
      ws.id = 'p2';
      ws.room = room;
      send(ws, { type: 'welcome', role: 'guest', id: 'p2', code: room.code, name: 'Cinder' });
      send(room.host, { type: 'peer', id: 'p2', joined: true });
      if (room.lastSnap) send(ws, room.lastSnap);
      return;
    }

    if (msg.type === 'guest' && ws.role === 'guest' && ws.room?.host) {
      send(ws.room.host, {
        type: 'guest',
        id: 'p2',
        x: num(msg.x),
        y: num(msg.y),
        z: num(msg.z),
        yaw: num(msg.yaw),
        crouch: !!msg.crouch,
        state: typeof msg.state === 'string' ? msg.state.slice(0, 16) : 'move',
        speed: Math.max(0, Math.min(14, num(msg.speed))),
      });
      return;
    }

    if (msg.type === 'act' && ws.role === 'guest' && ws.room?.host) {
      send(ws.room.host, {
        type: 'act',
        id: 'p2',
        act: msg.act === 'takedown' ? 'takedown' : '',
        guardId: typeof msg.guardId === 'string' ? msg.guardId.slice(0, 24) : '',
        x: num(msg.x),
        y: num(msg.y),
        z: num(msg.z),
        yaw: num(msg.yaw),
        crouch: !!msg.crouch,
      });
      return;
    }

    if (msg.type === 'snap' && ws.role === 'host' && ws.room) {
      ws.room.lastSnap = msg;
      if (ws.room.guest) send(ws.room.guest, msg);
    }
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    if (ws.role === 'host') {
      if (room.guest) send(room.guest, { type: 'hostleft' });
      rooms.delete(room.code);
      room.host = null;
    } else if (ws.role === 'guest' && room.guest === ws) {
      room.guest = null;
      if (room.host) send(room.host, { type: 'peer', id: 'p2', joined: false });
    }
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 20000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Shinzu listening on 0.0.0.0:${PORT}`);
});
