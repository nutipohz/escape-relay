const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });
const rooms = {};

function genCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

wss.on("connection", (ws) => {
  ws.pid  = Math.random().toString(36).substr(2, 8);
  ws.room = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "create_room") {
      const code = genCode();
      rooms[code] = [ws];
      ws.room = code;
      ws.send(JSON.stringify({ type: "room_created", code, pid: ws.pid }));

    } else if (msg.type === "join_room") {
      const code = msg.code.toUpperCase().trim();
      if (!rooms[code] || rooms[code].length >= 4) {
        ws.send(JSON.stringify({ type: "error", msg: "Комната не найдена или заполнена" }));
        return;
      }
      rooms[code].push(ws);
      ws.room = code;
      const pids = rooms[code].map(c => c.pid);
      rooms[code].forEach(peer => {
        if (peer !== ws)
          peer.send(JSON.stringify({ type: "peer_joined", pid: ws.pid, peers: pids }));
      });
      ws.send(JSON.stringify({ type: "joined", code, pid: ws.pid, peers: pids }));

    } else if (msg.type === "relay") {
      if (!ws.room || !rooms[ws.room]) return;
      const out = JSON.stringify({ type: "relay", from: ws.pid, data: msg.data });
      rooms[ws.room].forEach(peer => {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) peer.send(out);
      });

    } else if (msg.type === "start_game") {
      if (!ws.room || !rooms[ws.room]) return;
      rooms[ws.room].forEach(peer => {
        if (peer.readyState === WebSocket.OPEN)
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
      peer.send(JSON.stringify({ type: "peer_left", pid: ws.pid, peers: pids }));
    });
  });
});

console.log("Relay server started on port", process.env.PORT || 8080);
