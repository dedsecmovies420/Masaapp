import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
app.get("/health", (_, res) => res.json({ ok: true, service: "cocoon" }));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

const online = new Map();

function targetSocket(to) {
  return online.get(String(to || ""));
}

io.on("connection", socket => {
  socket.on("register", id => {
    const user = String(id || "").trim();
    if (!user || user.length > 64) return;
    const previous = online.get(user);
    if (previous && previous !== socket.id) io.to(previous).emit("session-replaced");
    online.set(user, socket.id);
    socket.data.user = user;
  });

  socket.on("message", packet => {
    const target = targetSocket(packet?.to);
    if (!target || !packet?.ciphertext || !packet?.iv) return;
    io.to(target).emit("message", {
      from: socket.data.user,
      ciphertext: packet.ciphertext,
      iv: packet.iv
    });
  });

  // Signalling only. Media never passes through this server.
  socket.on("call-start", packet => {
    const target = targetSocket(packet?.to);
    if (!target || !["voice", "video"].includes(packet?.kind)) return;
    io.to(target).emit("call-incoming", { from: socket.data.user, kind: packet.kind });
  });

  socket.on("call-response", packet => {
    const target = targetSocket(packet?.to);
    if (!target || !["accept", "reject"].includes(packet?.action)) return;
    io.to(target).emit("call-response", { from: socket.data.user, action: packet.action });
  });

  socket.on("webrtc", packet => {
    const target = targetSocket(packet?.to);
    if (!target || !packet?.data) return;
    io.to(target).emit("webrtc", { from: socket.data.user, data: packet.data });
  });

  socket.on("call-end", packet => {
    const target = targetSocket(packet?.to);
    if (target) io.to(target).emit("call-end", { from: socket.data.user });
  });

  socket.on("disconnect", () => {
    if (socket.data.user && online.get(socket.data.user) === socket.id) {
      online.delete(socket.data.user);
    }
  });
});

const port = process.env.PORT || 8787;
httpServer.listen(port, () => console.log(`Cocoon server listening on ${port}`));
