const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });
const rooms = {};

function genCode() {
  let code, tries = 0;
  do { code = Math.random().toString(36).substr(2, 6).toUpperCase(); tries++; }
  while (rooms[code] && tries < 20);
  return code;
}

// Пинг каждые 20 сек — Railway обрывает соединение через ~30 сек молчания
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 20000);

wss.on("connection", (ws) => {
  ws.pid    = Math.random().toString(36).substr(2, 8);
  ws.room   = null;
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "create_room") {
      const code = genCode();
      rooms[code] = [ws];
      ws.room = code;
      ws.send(JSON.stringify({ type: "room_created", code, pid: ws.pid }));

    } else if (msg.type === "join_room") {
      const code = msg.code?.toUpperCase().trim();
      if (!rooms[code] || rooms[code].length >= 4) {
        ws.send(JSON.stringify({ type: "error", msg: "Комната не найдена или заполнена" }));
        return;
      }
      rooms[code].push(ws);
      ws.room = code;
      const pids = rooms[code].map(c => c.pid);
      // Уведомляем остальных
      rooms[code].forEach(peer => {
        if (peer !== ws && peer.readyState === WebSocket.OPEN)
          peer.send(JSON.stringify({ type: "peer_joined", pid: ws.pid, peers: pids }));
      });
      // Подтверждение новому участнику
      ws.send(JSON.stringify({ type: "joined", code, pid: ws.pid, peers: pids }));

    } else if (msg.type === "relay") {
      if (!ws.room || !rooms[ws.room]) return;
      const out = JSON.stringify({ type: "relay", from: ws.pid, data: msg.data });
      rooms[ws.room].forEach(peer => {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) peer.send(out);
      });

    } else if (msg.type === "start_game") {
      if (!ws.room || !rooms[ws.room]) return;
      // Отправляем только гостям — хост сам уже переходит в игру
      rooms[ws.room].forEach(peer => {
        if (peer !== ws && peer.readyState === WebSocket.OPEN)
          peer.send(JSON.stringify({ type: "start_game" }));
      });
    }
  });

  ws.on("close", () => {
    if (!ws.room || !rooms[ws.room]) return;
    rooms[ws.room] = rooms[ws.room].filter(p => p !== ws);
    if (rooms[ws.room].length === 0) { delete rooms[ws.room]; return; }
    const pids = rooms[ws.room].map(c => c.pid);
    rooms[ws.room].forEach(peer => {
      if (peer.readyState === WebSocket.OPEN)
        peer.send(JSON.stringify({ type: "peer_left", pid: ws.pid, peers: pids }));
    });
  });
});

console.log("Relay server started on port", process.env.PORT || 8080);
