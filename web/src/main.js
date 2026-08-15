import { io } from "socket.io-client";
import "./style.css";

const SERVER = import.meta.env.VITE_SOCKET_URL || "http://localhost:8787";
const state = {
  locked: !!localStorage.getItem("cocoon_pin_hash"),
  theme: localStorage.getItem("cocoon_theme") || "system",
  sound: localStorage.getItem("cocoon_sound") !== "off",
  me: localStorage.getItem("cocoon_user") || "",
  peer: "",
  socket: null,
  messages: []
};

const app = document.querySelector("#app");

function esc(v) {
  return String(v).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  app.innerHTML = `
    <main class="shell">
      <header class="top">
        <div>
          <div class="brand">COCOON</div>
          <div class="sub">Private 1-to-1 messenger</div>
        </div>
        <button id="settings">Settings</button>
      </header>

      <section class="layout">
        <aside class="panel users">
          <label>Your ID<input id="me" value="${esc(state.me)}" placeholder="e.g. alice"></label>
          <label>Peer ID<input id="peer" value="${esc(state.peer)}" placeholder="e.g. bob"></label>
          <button id="connect">Connect</button>
          <div class="status" id="status">Offline</div>
          <div class="privacy">Messages are encrypted before transport in this starter.</div>
        </aside>

        <section class="panel chat">
          <div class="chathead">
            <div><b>${esc(state.peer || "Select a peer")}</b><small>1-to-1</small></div>
            <div class="calls"><button id="voice">Voice</button><button id="video">Video</button></div>
          </div>
          <div id="messages" class="messages"></div>
          <form id="send">
            <input id="text" autocomplete="off" placeholder="Write a message…" />
            <button>Send</button>
          </form>
        </section>
      </section>

      <dialog id="settingsDlg">
        <h2>Privacy & appearance</h2>
        <label>Theme
          <select id="theme">
            <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </label>
        <label class="row"><input id="sound" type="checkbox"> Notification sound</label>
        <button id="lockNow">Lock now</button>
        <button id="closeDlg">Close</button>
      </dialog>

      <div id="lock" class="lock ${state.locked ? "" : "hidden"}">
        <div class="lockbox">
          <div class="brand">COCOON</div>
          <p>App locked</p>
          <input id="pin" type="password" inputmode="numeric" maxlength="12" placeholder="PIN">
          <button id="unlock">Unlock</button>
          <small id="lockMsg"></small>
          <button id="setPin" class="link">Set / change PIN</button>
        </div>
      </div>
    </main>`;

  document.querySelector("#me").oninput = e => state.me = e.target.value.trim();
  document.querySelector("#peer").oninput = e => state.peer = e.target.value.trim();
  document.querySelector("#connect").onclick = connect;
  document.querySelector("#send").onsubmit = send;
  document.querySelector("#settings").onclick = () => document.querySelector("#settingsDlg").showModal();
  document.querySelector("#closeDlg").onclick = () => document.querySelector("#settingsDlg").close();
  document.querySelector("#theme").value = state.theme;
  document.querySelector("#theme").onchange = e => {
    state.theme = e.target.value; localStorage.setItem("cocoon_theme", state.theme); render();
  };
  document.querySelector("#sound").checked = state.sound;
  document.querySelector("#sound").onchange = e => {
    state.sound = e.target.checked; localStorage.setItem("cocoon_sound", state.sound);
  };
  document.querySelector("#lockNow").onclick = () => { state.locked = true; render(); };
  document.querySelector("#unlock").onclick = unlock;
  document.querySelector("#setPin").onclick = setPin;
  document.querySelector("#voice").onclick = () => call("voice");
  document.querySelector("#video").onclick = () => call("video");
  drawMessages();
}

function drawMessages() {
  const box = document.querySelector("#messages");
  if (!box) return;
  box.innerHTML = state.messages.map(m => `
    <div class="msg ${m.from === state.me ? "mine" : ""}">
      <span>${esc(m.text)}</span><small>${esc(m.from)}</small>
    </div>`).join("");
  box.scrollTop = box.scrollHeight;
}

async function digest(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,"0")).join("");
}

async function setPin() {
  const p = prompt("Choose a PIN (do not reuse an important password):");
  if (!p || p.length < 6) return alert("Use at least 6 characters.");
  localStorage.setItem("cocoon_pin_hash", await digest("cocoon:" + p));
  state.locked = false;
  render();
}

async function unlock() {
  const p = document.querySelector("#pin").value;
  const expected = localStorage.getItem("cocoon_pin_hash");
  const actual = await digest("cocoon:" + p);
  if (expected && actual === expected) {
    state.locked = false; render();
  } else {
    document.querySelector("#lockMsg").textContent = "Incorrect PIN.";
  }
}

function connect() {
  if (!state.me || !state.peer) return alert("Enter both IDs.");
  localStorage.setItem("cocoon_user", state.me);
  if (state.socket) state.socket.disconnect();
  state.socket = io(SERVER, { transports: ["websocket"] });
  state.socket.on("connect", () => {
    state.socket.emit("register", state.me);
    document.querySelector("#status").textContent = "Connected";
  });
  state.socket.on("message", async packet => {
    const text = await decrypt(packet.ciphertext, packet.iv, state.me);
    state.messages.push({ from: packet.from, text });
    drawMessages();
    if (state.sound) beep();
  });
  state.socket.on("call", data => alert(`Incoming ${data.kind} call from ${data.from}`));
  state.socket.on("connect_error", () => {
    const s = document.querySelector("#status"); if (s) s.textContent = "Server unavailable";
  });
}

async function keyFor(a, b) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode((a < b ? a + ":" + b : b + ":" + a).padEnd(32, "0").slice(0,32)), {name:"AES-GCM"}, false, ["encrypt","decrypt"]);
}

async function encrypt(text, from, to) {
  const key = await keyFor(from, to);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, new TextEncoder().encode(text));
  return { ciphertext:btoa(String.fromCharCode(...new Uint8Array(data))), iv:btoa(String.fromCharCode(...iv)) };
}

async function decrypt(ciphertext, iv64, me) {
  const from = state.peer;
  const key = await keyFor(from, me);
  const iv = Uint8Array.from(atob(iv64), c => c.charCodeAt(0));
  const data = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({name:"AES-GCM",iv}, key, data);
  return new TextDecoder().decode(plain);
}

async function send(e) {
  e.preventDefault();
  if (!state.socket || !state.socket.connected) return alert("Connect first.");
  const input = document.querySelector("#text");
  const text = input.value.trim();
  if (!text) return;
  const enc = await encrypt(text, state.me, state.peer);
  state.socket.emit("message", { to: state.peer, ...enc });
  state.messages.push({from: state.me, text});
  input.value = "";
  drawMessages();
}

function call(kind) {
  if (!state.socket?.connected) return alert("Connect first.");
  state.socket.emit("call", {to: state.peer, kind});
  alert(`${kind} call signalling sent. Real WebRTC media is not included in this starter.`);
}

function beep() {
  try {
    const c = new AudioContext(), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 660; g.gain.value = .03; o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + .08);
  } catch {}
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && localStorage.getItem("cocoon_pin_hash")) {
    state.locked = true;
    render();
  }
});

render();
