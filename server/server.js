import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
app.disable("x-powered-by");
app.get("/health", (_, res) => res.json({ ok: true, service: "cocoon" }));

const httpServer = http.createServer(app);
const allowedOrigin = process.env.ALLOWED_ORIGIN || true;
const io = new Server(httpServer, {
  cors: { origin: allowedOrigin, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 25000,
  pingTimeout: 20000
});

const online = new Map();
const USER_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const buckets = new Map();
const WINDOW_MS = 10_000;
const MAX_EVENTS = 80;

function targetSocket(to) { return online.get(String(to || "")); }
function validUser(id) { return USER_RE.test(String(id || "")); }
function allow(socket) {
  const now = Date.now();
  let b = buckets.get(socket.id);
  if (!b || now - b.started >= WINDOW_MS) b = { started: now, count: 0 };
  b.count += 1;
  buckets.set(socket.id, b);
  return b.count <= MAX_EVENTS;
}
function safeText(v, max = 8192) {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

io.on("connection", socket => {
  socket.on("register", id => {
    if (!allow(socket)) return;
    const user = String(id || "").trim();
    if (!validUser(user)) return socket.emit("protocol-error", "Invalid user ID.");
    const previous = online.get(user);
    if (previous && previous !== socket.id) io.to(previous).emit("session-replaced");
    online.set(user, socket.id);
    socket.data.user = user;
  });

  socket.on("message", packet => {
    if (!allow(socket) || !socket.data.user) return;
    const to = String(packet?.to || "").trim();
    const ciphertext = safeText(packet?.ciphertext, 24_000);
    const iv = safeText(packet?.iv, 128);
    if (!validUser(to) || !ciphertext || !iv) return;
    const target = targetSocket(to);
    if (!target) return;
    io.to(target).emit("message", { from: socket.data.user, ciphertext, iv });
  });

  socket.on("call-start", packet => {
    if (!allow(socket) || !socket.data.user) return;
    const to = String(packet?.to || "").trim();
    if (!validUser(to) || !["voice", "video"].includes(packet?.kind)) return;
    const target = targetSocket(to);
    if (target) io.to(target).emit("call-incoming", { from: socket.data.user, kind: packet.kind });
  });

  socket.on("call-response", packet => {
    if (!allow(socket) || !socket.data.user) return;
    const to = String(packet?.to || "").trim();
    if (!validUser(to) || !["accept", "reject"].includes(packet?.action)) return;
    const target = targetSocket(to);
    if (target) io.to(target).emit("call-response", { from: socket.data.user, action: packet.action });
  });

  // Signalling only. Media is peer-to-peer when WebRTC can establish a path.
  socket.on("webrtc", packet => {
    if (!allow(socket) || !socket.data.user) return;
    const to = String(packet?.to || "").trim();
    const data = packet?.data;
    if (!validUser(to) || !data || typeof data !== "object") return;
    const target = targetSocket(to);
    if (target) io.to(target).emit("webrtc", { from: socket.data.user, data });
  });

  socket.on("call-end", packet => {
    if (!allow(socket) || !socket.data.user) return;
    const to = String(packet?.to || "").trim();
    if (!validUser(to)) return;
    const target = targetSocket(to);
    if (target) io.to(target).emit("call-end", { from: socket.data.user });
  });

  socket.on("disconnect", () => {
    buckets.delete(socket.id);
    if (socket.data.user && online.get(socket.data.user) === socket.id) online.delete(socket.data.user);
  });
});

const port = Number(process.env.PORT) || 8787;
httpServer.listen(port, () => console.log(`Cocoon server listening on ${port}`));
