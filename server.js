// Deno Deploy — relay сервер для Escape from Home
const rooms = new Map();

function genCode() {
  let code, tries = 0;
  do { code = Math.random().toString(36).substr(2, 6).toUpperCase(); tries++; }
  while (rooms.has(code) && tries < 20);
  return code;
}

Deno.serve((req) => {
  // HTTP — для UptimeRobot
  if (req.headers.get("upgrade") !== "websocket") {
    return new Response("OK", { status: 200 });
  }

  const { socket: ws, response } = Deno.upgradeWebSocket(req);
  const pid = Math.random().toString(36).substr(2, 8);
  let room = null;

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === "create_room") {
      const code = genCode();
      rooms.set(code, [ws]);
      ws._pid = pid; ws._room = code; room = code;
      ws.send(JSON.stringify({ type: "room_created", code, pid }));

    } else if (msg.type === "join_room") {
      const code = msg.code?.toUpperCase().trim();
      const peers = rooms.get(code);
      if (!peers || peers.length >= 4) {
        ws.send(JSON.stringify({ type: "error", msg: "Комната не найдена или заполнена" }));
        return;
      }
      peers.push(ws);
      ws._pid = pid; ws._room = code; room = code;
      const pids = peers.map(p => p._pid);
      peers.forEach(p => {
        if (p !== ws && p.readyState === WebSocket.OPEN)
          p.send(JSON.stringify({ type: "peer_joined", pid, peers: pids }));
      });
      ws.send(JSON.stringify({ type: "joined", code, pid, peers: pids }));

    } else if (msg.type === "relay") {
      if (!room || !rooms.has(room)) return;
      const out = JSON.stringify({ type: "relay", from: pid, data: msg.data });
      rooms.get(room).forEach(p => {
        if (p !== ws && p.readyState === WebSocket.OPEN) p.send(out);
      });

    } else if (msg.type === "start_game") {
      if (!room || !rooms.has(room)) return;
      rooms.get(room).forEach(p => {
        if (p !== ws && p.readyState === WebSocket.OPEN)
          p.send(JSON.stringify({ type: "start_game" }));
      });
    }
  };

  ws.onclose = () => {
    if (!room || !rooms.has(room)) return;
    const remaining = rooms.get(room).filter(p => p !== ws);
    if (remaining.length === 0) { rooms.delete(room); return; }
    rooms.set(room, remaining);
    const pids = remaining.map(p => p._pid);
    remaining.forEach(p => {
      if (p.readyState === WebSocket.OPEN)
        p.send(JSON.stringify({ type: "peer_left", pid, peers: pids }));
    });
  };

  return response;
});
