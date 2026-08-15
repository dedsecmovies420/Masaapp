import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
app.get("/health", (_, res) => res.json({ok:true, service:"cocoon"}));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const online = new Map();

io.on("connection", socket => {
  socket.on("register", id => {
    if (!id) return;
    online.set(String(id), socket.id);
    socket.data.user = String(id);
  });

  socket.on("message", packet => {
    const target = online.get(String(packet.to));
    if (!target) return;
    // The server relays ciphertext only. It does not intentionally decrypt it.
    io.to(target).emit("message", {
      from: socket.data.user,
      ciphertext: packet.ciphertext,
      iv: packet.iv
    });
  });

  socket.on("call", packet => {
    const target = online.get(String(packet.to));
    if (!target) return;
    io.to(target).emit("call", {from: socket.data.user, kind: packet.kind});
  });

  socket.on("disconnect", () => {
    if (socket.data.user && online.get(socket.data.user) === socket.id) {
      online.delete(socket.data.user);
    }
  });
});

const port = process.env.PORT || 8787;
httpServer.listen(port, () => console.log(`Cocoon server listening on ${port}`));
