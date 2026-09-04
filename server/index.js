'use strict';

/**
 * Relay for shared scoreboards.
 *
 * Phones join a room by its short code and push the whole match state whenever
 * they change it; the relay keeps the latest snapshot per room and forwards it
 * to everyone else in that room. It holds no game rules of its own — the app
 * owns those — so this stays a dumb, replaceable pipe.
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const ROOM_CODE = /^[A-Z0-9]{4,8}$/;
const MAX_ROOMS = 500;
const MAX_CLIENTS_PER_ROOM = 8;
const MAX_MESSAGE_BYTES = 32 * 1024;
const IDLE_ROOM_MS = 6 * 60 * 60 * 1000; // forget a room 6h after its last update
const HEARTBEAT_MS = 30 * 1000;

/** code -> { rev, state, updatedAt, clients:Set<WebSocket> } */
const rooms = new Map();

const server = http.createServer((req, res) => {
  // The app polls this from another origin to wake a sleeping free instance and
  // to know when it's actually up, so it has to be readable cross-origin.
  if (req.method === 'GET' && (req.url === '/' || req.url === '/healthz')) {
    res.writeHead(200, {
      'content-type': 'text/plain',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    res.end(`ok — ${rooms.size} room(s)\n`);
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function roomFor(code) {
  let room = rooms.get(code);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) sweep(true);
    if (rooms.size >= MAX_ROOMS) return null;
    room = { rev: 0, state: null, updatedAt: Date.now(), clients: new Set() };
    rooms.set(code, room);
  }
  return room;
}

/** Drops rooms nobody is in and nobody has touched in a while. */
function sweep(aggressive = false) {
  const cutoff = Date.now() - (aggressive ? 0 : IDLE_ROOM_MS);
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && room.updatedAt <= cutoff) rooms.delete(code);
  }
}

wss.on('connection', (socket) => {
  let joined = null;

  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  const leave = () => {
    if (!joined) return;
    const room = rooms.get(joined);
    if (room) {
      room.clients.delete(socket);
      broadcast(joined, socket, { type: 'peers', count: room.clients.size });
    }
    joined = null;
  };

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'join') {
      const code = String(message.room || '').toUpperCase();
      if (!ROOM_CODE.test(code)) {
        send(socket, { type: 'error', reason: 'bad-code' });
        return;
      }

      leave();
      const room = roomFor(code);
      if (!room) {
        send(socket, { type: 'error', reason: 'busy' });
        return;
      }
      if (room.clients.size >= MAX_CLIENTS_PER_ROOM) {
        send(socket, { type: 'error', reason: 'full' });
        return;
      }

      joined = code;
      room.clients.add(socket);
      // Whatever the room already knows wins over whatever the joiner has.
      send(socket, {
        type: 'joined',
        room: code,
        rev: room.rev,
        state: room.state,
        peers: room.clients.size,
      });
      broadcast(code, socket, { type: 'peers', count: room.clients.size });
      return;
    }

    if (message.type === 'push') {
      const room = joined && rooms.get(joined);
      if (!room || !message.state) return;
      room.rev += 1;
      room.state = message.state;
      room.updatedAt = Date.now();
      send(socket, { type: 'ack', rev: room.rev });
      broadcast(joined, socket, { type: 'state', rev: room.rev, state: room.state });
      return;
    }

    if (message.type === 'leave') leave();
  });

  socket.on('close', leave);
  socket.on('error', leave);
});

function broadcast(code, except, message) {
  const room = rooms.get(code);
  if (!room) return;
  for (const client of room.clients) {
    if (client !== except) send(client, message);
  }
}

// Render's proxy closes quiet connections, so keep them warm and reap dead ones.
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
  sweep();
}, HEARTBEAT_MS);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`ping pong relay listening on ${PORT}`);
});
