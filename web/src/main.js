import { io } from "socket.io-client";
import "./style.css";

const SERVER = import.meta.env.VITE_SOCKET_URL || "http://localhost:8787";
const PIN_KEY = "cocoon_pin_v2";
const state = {
  locked: !!localStorage.getItem(PIN_KEY) || !!localStorage.getItem("cocoon_pin_hash"),
  theme: localStorage.getItem("cocoon_theme") || "system",
  sound: localStorage.getItem("cocoon_sound") !== "off",
  notifications: localStorage.getItem("cocoon_notifications") === "on",
  preview: localStorage.getItem("cocoon_notification_preview") === "on",
  autoLock: localStorage.getItem("cocoon_autolock") !== "off",
  me: localStorage.getItem("cocoon_user") || "",
  peer: "",
  socket: null,
  messages: [],
  call: { pc: null, stream: null, remote: null, kind: null, peer: null, initiator: false },
  pinSetupMode: "set",
  e2ee: { keyPair: null, publicJwk: null, peerPublicJwk: null, aesKey: null, fingerprint: "" }
};

const app = document.querySelector("#app");
const esc = v => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[c]));
let idleTimer = null;
let ringtoneTimer = null;
let audioCtx = null;
let notificationRegistration = null;


async function fingerprintFromPublicKey(publicKey) {
  try {
    const raw = await crypto.subtle.exportKey("raw", publicKey);
    const digest = await crypto.subtle.digest("SHA-256", raw);
    const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    return hex.match(/.{1,4}/g)?.join(" ") || hex;
  } catch { return "Unavailable"; }
}
async function updateE2EEVerificationUI() {
  const statusEl = document.querySelector("#e2eeStatus");
  const mineEl = document.querySelector("#myFingerprint");
  const peerEl = document.querySelector("#peerFingerprint");
  if (!statusEl || !mineEl || !peerEl) return;
  try {
    const myFp = state.ecdh?.publicKey ? await fingerprintFromPublicKey(state.ecdh.publicKey) : "Unavailable";
    const peerKey = state.peerPublicKey || state.peerKey || null;
    mineEl.textContent = myFp;
    peerEl.textContent = peerKey ? await fingerprintFromPublicKey(peerKey) : "Not available";
    statusEl.textContent = peerKey ? "🔒 E2EE key established" : "⚠️ Peer key not established";
  } catch { statusEl.textContent = "⚠️ E2EE status unavailable"; }
  document.querySelector("#copyMyFingerprint")?.addEventListener("click", () => navigator.clipboard?.writeText(mineEl.textContent), {once:true});
  document.querySelector("#copyPeerFingerprint")?.addEventListener("click", () => navigator.clipboard?.writeText(peerEl.textContent), {once:true});
  document.querySelector("#verifyFingerprint")?.addEventListener("click", () => {
    const fp = peerEl.textContent;
    if (!fp || fp === "Not available" || fp === "Unavailable") return alert("Connect to the peer first.");
    alert("Verify this fingerprint with your peer through a separate trusted channel:\\n\\n" + fp);
  }, {once:true});
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  const isLight = state.theme === "light" ||
    (state.theme === "system" && matchMedia("(prefers-color-scheme: light)").matches);
  if (meta) meta.content = isLight ? "#f4f6fb" : "#0b1020";
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (!state.autoLock || !localStorage.getItem(PIN_KEY)) return;
  idleTimer = setTimeout(() => lockApp("timeout"), 5 * 60 * 1000);
}

function lockApp(reason = "manual") {
  if (!localStorage.getItem(PIN_KEY)) {
    alert("Set an App Lock PIN first.");
    return;
  }
  state.locked = true;
  stopRingtone();
  if (state.call.peer) endCall(true);
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  render();
  const msg = document.querySelector("#lockMsg");
  if (msg) msg.textContent = reason === "timeout" ? "Locked after 5 minutes of inactivity." : "";
}

function render() {
  applyTheme();
  app.innerHTML = `
    <main class="shell">
      <header class="top">
        <div><div class="brand">COCOON</div><div class="sub">Private 1-to-1 messenger</div></div>
        <button id="settings">Settings</button>
      </header>
      <section class="layout">
        <aside class="panel users">
          <label>Your ID<input id="me" value="${esc(state.me)}" placeholder="e.g. alice" maxlength="64"></label>
          <label>Peer ID<input id="peer" value="${esc(state.peer)}" placeholder="e.g. bob" maxlength="64"></label>
          <button id="connect">Connect</button><div class="status" id="status">${state.socket?.connected ? "Connected" : "Offline"}</div>
          <div class="privacy">
            <b>Private transport</b><br>
            E2EE session: <span id="e2eeStatus">Not established</span>
            <div id="fingerprint" class="fingerprint"></div>
          </div>
        </aside>
        <section class="panel chat">
          <div class="chathead">
            <div><b>${esc(state.peer || "Select a peer")}</b><small>1-to-1</small></div>
            <div class="calls"><button id="voice">Voice</button><button id="video">Video</button></div>
          </div>
          <div id="messages" class="messages"></div>
          <form id="send"><input id="text" autocomplete="off" placeholder="Write a message…"><button>Send</button></form>
        </section>
      </section>

      <dialog id="settingsDlg">
        <h2>Privacy & appearance</h2>
        <label>Theme
          <select id="theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
        </label>
        <label class="row"><input id="sound" type="checkbox"> Notification & call sound</label>
        <label class="row"><input id="notifications" type="checkbox"> Browser notifications</label>
        <label class="row"><input id="preview" type="checkbox"> Show message text in notifications</label>
        <label class="row"><input id="autoLock" type="checkbox"> Auto-lock after 5 minutes</label>
        <div class="settings-actions">
          <button id="notify">Enable / test notifications</button>
          <button id="testSound">Test sound</button>
          <button id="pinSettings">${localStorage.getItem(PIN_KEY) ? "Change App Lock PIN" : "Set App Lock PIN"}</button>
          <button id="lockNow">Lock now</button>
          <button id="closeDlg">Close</button>
        </div>
        <small id="notifyStatus"></small>
      </dialog>

      <dialog id="pinDlg">
        <h2>${state.pinSetupMode === "change" ? "Change App Lock PIN" : "Set App Lock PIN"}</h2>
        ${state.pinSetupMode === "change" ? '<label>Current PIN<input id="currentPin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="12"></label>' : ""}
        <label>New PIN<input id="newPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="12"></label>
        <label>Confirm PIN<input id="confirmPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="12"></label>
        <small id="pinSetupMsg"></small>
        <div class="settings-actions"><button id="savePin">Save PIN</button><button id="cancelPin">Cancel</button></div>
      </dialog>

      <div id="incoming" class="overlay hidden">
        <div class="callbox"><h2 id="incomingTitle">Incoming call</h2><p id="incomingFrom"></p>
          <div class="callactions"><button id="acceptCall">Accept</button><button id="rejectCall">Reject</button></div>
        </div>
      </div>
      <div id="call" class="overlay hidden">
        <div class="callbox active"><h2 id="callTitle">Call</h2>
          <audio id="remoteAudio" autoplay></audio><video id="remoteVideo" autoplay playsinline></video><video id="localVideo" autoplay muted playsinline></video>
          <p id="callStatus">Connecting…</p><button id="endCall">End call</button>
        </div>
      </div>

      <div id="lock" class="lock ${state.locked ? "" : "hidden"}">
        <div class="lockbox"><div class="brand">COCOON</div><p>App locked</p>
          <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="12" placeholder="PIN">
          <button id="unlock">Unlock</button><small id="lockMsg"></small>
          <button id="setPin" class="link">${localStorage.getItem(PIN_KEY) ? "Change PIN" : "Set PIN"}</button>
        </div>
      </div>
    </main>`;

  const me = document.querySelector("#me"), peer = document.querySelector("#peer");
  me.oninput = e => { state.me = e.target.value.trim(); localStorage.setItem("cocoon_user", state.me); resetIdleTimer(); };
  peer.oninput = e => { state.peer = e.target.value.trim(); resetIdleTimer(); };
  document.querySelector("#connect").onclick = connect;
  document.querySelector("#send").onsubmit = send;
  document.querySelector("#settings").onclick = () => document.querySelector("#settingsDlg").showModal();
  document.querySelector("#closeDlg").onclick = () => document.querySelector("#settingsDlg").close();

  document.querySelector("#theme").value = state.theme;
  document.querySelector("#theme").onchange = e => {
    state.theme = e.target.value; localStorage.setItem("cocoon_theme", state.theme); applyTheme();
  };
  document.querySelector("#sound").checked = state.sound;
  document.querySelector("#sound").onchange = e => { state.sound = e.target.checked; localStorage.setItem("cocoon_sound", state.sound ? "on" : "off"); };
  document.querySelector("#notifications").checked = state.notifications;
  document.querySelector("#notifications").onchange = async e => {
    state.notifications = e.target.checked;
    localStorage.setItem("cocoon_notifications", state.notifications ? "on" : "off");
    if (state.notifications) await enableNotifications();
  };
  document.querySelector("#preview").checked = state.preview;
  document.querySelector("#preview").onchange = e => {
    state.preview = e.target.checked; localStorage.setItem("cocoon_notification_preview", state.preview ? "on" : "off");
  };
  document.querySelector("#autoLock").checked = state.autoLock;
  document.querySelector("#autoLock").onchange = e => {
    state.autoLock = e.target.checked; localStorage.setItem("cocoon_autolock", state.autoLock ? "on" : "off"); resetIdleTimer();
  };
  document.querySelector("#notify").onclick = enableNotifications;
  document.querySelector("#testSound").onclick = () => {
    if (!state.sound) { alert("Turn on Notification & call sound first."); return; }
    playTone("message");
  };
  document.querySelector("#pinSettings").onclick = () => openPinDialog(localStorage.getItem(PIN_KEY) ? "change" : "set");
  document.querySelector("#lockNow").onclick = () => { document.querySelector("#settingsDlg").close(); lockApp("manual"); };
  document.querySelector("#cancelPin").onclick = () => document.querySelector("#pinDlg").close();
  document.querySelector("#savePin").onclick = savePin;
  document.querySelector("#unlock").onclick = unlock;
  document.querySelector("#setPin").onclick = () => openPinDialog(localStorage.getItem(PIN_KEY) ? "change" : "set");
  document.querySelector("#voice").onclick = () => startCall("voice");
  document.querySelector("#video").onclick = () => startCall("video");
  document.querySelector("#acceptCall").onclick = acceptIncoming;
  document.querySelector("#rejectCall").onclick = rejectIncoming;
  document.querySelector("#endCall").onclick = () => endCall(false);
  drawMessages();
  resetIdleTimer();
}

function openPinDialog(mode) {
  if (state.locked) return;
  state.pinSetupMode = mode;
  document.querySelector("#pinDlg").close();
  // Re-render so the correct fields are present, then open the dialog.
  render();
  document.querySelector("#settingsDlg")?.close();
  document.querySelector("#pinDlg").showModal();
}

function drawMessages() {
  const box = document.querySelector("#messages");
  if (!box) return;
  box.innerHTML = state.messages.map(m => `<div class="msg ${m.from===state.me?"mine":""}"><span>${esc(m.text)}</span><small>${esc(m.from)}</small></div>`).join("");
  box.scrollTop = box.scrollHeight;
}

function historyKey() {
  if (!state.me || !state.peer) return "";
  const ids = [state.me.trim(), state.peer.trim()].sort();
  return `cocoon_history_v1:${ids[0]}::${ids[1]}`;
}

function loadMessageHistory() {
  const key = historyKey();
  if (!key) {
    state.messages = [];
    return;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    state.messages = Array.isArray(saved) ? saved : [];
  } catch {
    state.messages = [];
  }
}

function saveMessageHistory() {
  const key = historyKey();
  if (!key) return;

  try {
    localStorage.setItem(key, JSON.stringify(state.messages));
  } catch (err) {
    console.warn("Could not save message history:", err);
  }
}


async function derivePinVerifier(pin, saltB64) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), c => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  if (crypto.subtle?.deriveBits) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({name:"PBKDF2", salt, iterations:150000, hash:"SHA-256"}, base, 256);
    return { saltB64: btoa(String.fromCharCode(...salt)), verifierB64: btoa(String.fromCharCode(...new Uint8Array(bits))), method:"pbkdf2" };
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`cocoon:${saltB64}:${pin}`));
  return { saltB64: btoa(String.fromCharCode(...salt)), verifierB64: btoa(String.fromCharCode(...new Uint8Array(digest))), method:"sha256-fallback" };
}

async function verifyPin(pin) {
  const stored = JSON.parse(localStorage.getItem(PIN_KEY) || "null");
  if (!stored) {
    // Migrate the previous demo SHA-256 verifier if it exists.
    const legacy = localStorage.getItem("cocoon_pin_hash");
    if (!legacy) return false;
    const actual = await legacyDigest(pin);
    return actual === legacy;
  }
  const result = await derivePinVerifier(pin, stored.saltB64);
  const a = Uint8Array.from(atob(result.verifierB64), c => c.charCodeAt(0));
  const b = Uint8Array.from(atob(stored.verifierB64), c => c.charCodeAt(0));
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function legacyDigest(pin) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("cocoon:" + pin));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,"0")).join("");
}

async function savePin() {
  const msg = document.querySelector("#pinSetupMsg");
  const current = document.querySelector("#currentPin")?.value || "";
  const next = document.querySelector("#newPin")?.value || "";
  const confirm = document.querySelector("#confirmPin")?.value || "";
  if (!/^\d{6,12}$/.test(next)) { msg.textContent = "Use a 6–12 digit PIN."; return; }
  if (next !== confirm) { msg.textContent = "PIN confirmation does not match."; return; }
  if (localStorage.getItem(PIN_KEY) && !(await verifyPin(current))) { msg.textContent = "Current PIN is incorrect."; return; }
  const result = await derivePinVerifier(next);
  localStorage.setItem(PIN_KEY, JSON.stringify(result));
  localStorage.removeItem("cocoon_pin_hash");
  state.locked = false;
  document.querySelector("#pinDlg").close();
  render();
}

async function unlock() {
  const input = document.querySelector("#pin");
  const msg = document.querySelector("#lockMsg");
  const p = input.value;
  if (!p) { msg.textContent = "Enter your PIN."; return; }
  if (await verifyPin(p)) {
    state.locked = false;
    input.value = "";
    msg.textContent = "";
    render();
    // Do not automatically reconnect: user must press Connect after unlock.
  } else {
    input.value = "";
    msg.textContent = "Incorrect PIN.";
  }
}


function b64FromBytes(bytes) {
  let s = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
function bytesFromB64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function ensureE2EEIdentity() {
  if (!crypto?.subtle || !crypto.subtle.generateKey) throw new Error("Secure cryptography is not supported by this browser.");
  const saved = localStorage.getItem("cocoon_e2ee_public");
  const privSaved = localStorage.getItem("cocoon_e2ee_private");
  if (saved && privSaved) {
    try {
      state.e2ee.publicJwk = JSON.parse(saved);
      state.e2ee.keyPair = {
        publicKey: await crypto.subtle.importKey("jwk", state.e2ee.publicJwk, {name:"ECDH", namedCurve:"P-256"}, true, []),
        privateKey: await crypto.subtle.importKey("jwk", JSON.parse(privSaved), {name:"ECDH", namedCurve:"P-256"}, true, ["deriveBits"])
      };
      return;
    } catch {}
  }
  const kp = await crypto.subtle.generateKey({name:"ECDH", namedCurve:"P-256"}, true, ["deriveBits"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  state.e2ee.keyPair = kp;
  state.e2ee.publicJwk = publicJwk;
  localStorage.setItem("cocoon_e2ee_public", JSON.stringify(publicJwk));
  localStorage.setItem("cocoon_e2ee_private", JSON.stringify(privateJwk));
}

async function fingerprintJwk(jwk) {
  const canonical = JSON.stringify({crv:jwk.crv,kty:jwk.kty,x:jwk.x,y:jwk.y});
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  return [...digest].map(x => x.toString(16).padStart(2,"0")).join("").match(/.{1,4}/g).join(" ");
}

async function establishPeerKey(jwk) {
  if (!jwk) return;
  try {
    const peer = await crypto.subtle.importKey("jwk", jwk, {name:"ECDH", namedCurve:"P-256"}, true, []);
    const bits = await crypto.subtle.deriveBits({name:"ECDH", public:peer}, state.e2ee.keyPair.privateKey, 256);
    const baseKey = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
    const salt = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
      JSON.stringify([state.e2ee.publicJwk, jwk].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))
    ));
    state.e2ee.aesKey = await crypto.subtle.deriveKey(
      {name:"HKDF", hash:"SHA-256", salt, info:new TextEncoder().encode("Cocoon E2EE v1")},
      baseKey, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]
    );
    state.e2ee.peerPublicJwk = jwk;
    state.e2ee.fingerprint = await fingerprintJwk(jwk);
    const fp = document.querySelector("#fingerprint"), st = document.querySelector("#e2eeStatus");
    if (fp) fp.textContent = `Peer key fingerprint: ${state.e2ee.fingerprint}`;
    if (st) st.textContent = "Established";
  } catch (e) {
    state.e2ee.aesKey = null;
    const st = document.querySelector("#e2eeStatus"); if (st) st.textContent = "Failed";
  }
}

async function encryptE2EE(text) {
  if (!state.e2ee.aesKey) throw new Error("E2EE session is not established.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({name:"AES-GCM",iv}, state.e2ee.aesKey, new TextEncoder().encode(text));
  return {
    ciphertext: b64FromBytes(new Uint8Array(data)),
    iv: b64FromBytes(iv),
    senderKey: state.e2ee.publicJwk
  };
}

async function decryptE2EE(ciphertext, iv64) {
  if (!state.e2ee.aesKey) throw new Error("E2EE session is not established.");
  const iv = bytesFromB64(iv64), data = bytesFromB64(ciphertext);
  const plain = await crypto.subtle.decrypt({name:"AES-GCM",iv}, state.e2ee.aesKey, data);
  return new TextDecoder().decode(plain);
}

async function connect() {
  resetIdleTimer();
  if (!state.me || !state.peer) return alert("Enter both IDs.");
  
loadMessageHistory();
drawMessages();

  try { await ensureE2EEIdentity(); } catch (e) { return alert(e.message); }
  localStorage.setItem("cocoon_user", state.me);
  if (state.socket) state.socket.disconnect();
  state.e2ee.aesKey = null;
  const es = document.querySelector("#e2eeStatus"); if (es) es.textContent = "Negotiating…";
  state.socket = io(SERVER, {transports:["websocket","polling"]});
  state.socket.on("connect", () => {
    state.socket.emit("register", state.me);
    state.socket.emit("key-publish", { publicKey: state.e2ee.publicJwk });
    state.socket.emit("key-request", { to: state.peer });
    const s = document.querySelector("#status"); if (s) s.textContent = "Connected";
  });
  state.socket.on("message", async packet => {
    try {
      if (packet.senderKey && !state.e2ee.aesKey) await establishPeerKey(packet.senderKey);
      const text = await decrypt(packet.ciphertext, packet.iv, state.me);
      state.messages.push({from:packet.from, text});
      saveMessageHistory();
      drawMessages();
      if (state.sound) beep();
      if (state.notifications) notifyUser("New message", text);
    } catch {}
  });
  state.socket.on("key", async packet => {
    if (packet.from !== state.peer) return;
    await establishPeerKey(packet.publicKey);
  });
  state.socket.on("key-request", packet => {
    if (packet.from === state.peer) state.socket.emit("key-publish", { publicKey: state.e2ee.publicJwk, to: state.peer });
  });
  state.socket.on("call-incoming", data => incomingCall(data));
  state.socket.on("call-response", data => {
    stopRingtone();
    if (data.action === "accept") createPeerConnection(true);
    else if (data.action === "reject") { closeCallUI(); notifyUser("Call declined", "Your call was declined."); }
  });
  state.socket.on("webrtc", async packet => {
    if (packet.from !== state.call.peer) return;
    await handleSignal(packet.data);
  });
  state.socket.on("call-end", () => { stopRingtone(); closePeer(); closeCallUI(); });
  state.socket.on("session-replaced", () => { const s = document.querySelector("#status"); if (s) s.textContent = "Session replaced"; });
  state.socket.on("connect_error", () => { const s = document.querySelector("#status"); if (s) s.textContent = "Server unavailable"; });
}

async function encrypt(text,from,to) {
  return encryptE2EE(text);
}
async function decrypt(ciphertext,iv64,me) {
  return decryptE2EE(ciphertext,iv64);
}
async function send(e) {
  e.preventDefault(); resetIdleTimer();
  if (!state.socket?.connected) return alert("Connect first.");
  if (!state.e2ee.aesKey) return alert("Secure E2EE session is not ready. Connect to the peer and wait a moment.");
  const input=document.querySelector("#text"),text=input.value.trim();
  if (!text) return;
  const enc=await encrypt(text,state.me,state.peer);
  state.socket.emit("message",{to:state.peer,...enc});
  state.messages.push({from:state.me,text});
saveMessageHistory();
input.value="";
drawMessages();
}

async function startCall(kind) {
  resetIdleTimer();
  if (!state.socket?.connected) return alert("Connect first.");
  if (!navigator.mediaDevices?.getUserMedia) return alert("This browser does not support microphone/camera access.");
  state.call={...state.call,kind,peer:state.peer,initiator:true};
  showCallUI(kind,"Waiting for answer…");
  state.socket.emit("call-start",{to:state.peer,kind});
  if (state.sound) startRingtone();
  notifyUser(`Outgoing ${kind} call`, `Calling ${state.peer}`);
}
function incomingCall(data) {
  state.call.kind=data.kind; state.call.peer=data.from;
  showIncoming(data);
  if (state.sound) startRingtone();
  notifyUser(`Incoming ${data.kind} call`, `Call from ${data.from}`);
}
function showIncoming(data) {
  document.querySelector("#incomingTitle").textContent=`Incoming ${data.kind} call`;
  document.querySelector("#incomingFrom").textContent=`From ${data.from}`;
  document.querySelector("#incoming").classList.remove("hidden");
}
async function acceptIncoming() {
  stopRingtone();
  document.querySelector("#incoming").classList.add("hidden");
  state.call.initiator=false;
  state.socket.emit("call-response",{to:state.call.peer,action:"accept"});
  await createPeerConnection(false);
}
function rejectIncoming() {
  stopRingtone();
  document.querySelector("#incoming").classList.add("hidden");
  state.socket.emit("call-response",{to:state.call.peer,action:"reject"});
  state.call.peer=null;
}
async function createPeerConnection(initiator) {
  if (state.call.pc) closePeer();
  const kind=state.call.kind;
  state.call.pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  const pc=state.call.pc;
  pc.onicecandidate=e=>{if(e.candidate)state.socket.emit("webrtc",{to:state.call.peer,data:{type:"ice",candidate:e.candidate}});};
  pc.ontrack=e=>{const stream=e.streams[0]; const v=document.querySelector("#remoteVideo"); const a=document.querySelector("#remoteAudio"); if(kind==="video"){if(v)v.srcObject=stream;} else {if(a)a.srcObject=stream;}};
  pc.onconnectionstatechange=()=>{const s=document.querySelector("#callStatus");if(s)s.textContent=pc.connectionState;if(["failed","closed","disconnected"].includes(pc.connectionState)){closePeer();closeCallUI();}};
  try {
    const stream=await navigator.mediaDevices.getUserMedia(kind==="video"?{audio:true,video:true}:{audio:true,video:false});
    state.call.stream=stream; stream.getTracks().forEach(t=>pc.addTrack(t,stream));
    const local=document.querySelector("#localVideo"); if(local){local.srcObject=stream;local.style.display=kind==="video"?"block":"none";}
    if(initiator){const offer=await pc.createOffer();await pc.setLocalDescription(offer);state.socket.emit("webrtc",{to:state.call.peer,data:{type:"offer",sdp:pc.localDescription}});showCallUI(kind,"Calling…");}
  } catch(err) { alert(`Could not access ${kind} device: ${err.message}`); endCall(true); }
}
async function handleSignal(data) {
  if (!state.call.pc && data.type!=="offer") return;
  let pc=state.call.pc;
  if(data.type==="offer"){
    if(!state.call.pc) { await createPeerConnection(false); pc=state.call.pc; }
    await pc.setRemoteDescription(data.sdp);
    const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
    state.socket.emit("webrtc",{to:state.call.peer,data:{type:"answer",sdp:pc.localDescription}});
  } else if(data.type==="answer") await pc.setRemoteDescription(data.sdp);
  else if(data.type==="ice"){try{await pc.addIceCandidate(data.candidate);}catch{}}
}
function showCallUI(kind,status){document.querySelector("#callTitle").textContent=kind==="video"?"Video call":"Voice call";document.querySelector("#callStatus").textContent=status;document.querySelector("#call").classList.remove("hidden");}
function closeCallUI(){document.querySelector("#call")?.classList.add("hidden");document.querySelector("#incoming")?.classList.add("hidden");}
function closePeer(){if(state.call.stream)state.call.stream.getTracks().forEach(t=>t.stop());if(state.call.pc)state.call.pc.close();state.call.pc=null;state.call.stream=null;}
function endCall(silent=false){if(!silent&&state.socket?.connected&&state.call.peer)state.socket.emit("call-end",{to:state.call.peer});stopRingtone();closePeer();closeCallUI();state.call={pc:null,stream:null,remote:null,kind:null,peer:null,initiator:false};}

async function enableNotifications() {
  const status = document.querySelector("#notifyStatus");
  if (!("Notification" in window)) {
    if (status) status.textContent = "This browser does not support notifications.";
    return false;
  }
  try {
    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;

    if (permission !== "granted") {
      state.notifications = false;
      localStorage.setItem("cocoon_notifications", "off");
      if (status) status.textContent = `Notification permission: ${permission}.`;
      return false;
    }

    state.notifications = true;
    localStorage.setItem("cocoon_notifications", "on");

    if ("serviceWorker" in navigator) {
      try { notificationRegistration = await navigator.serviceWorker.ready; } catch {}
    }

    // Use the normal Notification API for the immediate test. This works
    // on more browsers than relying only on ServiceWorkerRegistration.showNotification().
    try {
      new Notification("Cocoon", {
        body: state.preview ? "Notifications are enabled." : "Notifications are enabled.",
        tag: "cocoon-test"
      });
    } catch {}

    if (status) status.textContent = "Notifications enabled.";
    return true;
  } catch (err) {
    if (status) status.textContent = "Notification permission could not be enabled.";
    return false;
  }
}

async function notifyUser(title, body) {
  if (!state.notifications || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    // When the page is visible, use Notification directly.
    // When hidden, prefer the service worker.
    if (!document.hidden) {
      new Notification(title, {
        body: state.preview ? body : "You have a new Cocoon notification.",
        tag: "cocoon",
        renotify: true,
        silent: !state.sound
      });
      return;
    }

    if (!notificationRegistration && "serviceWorker" in navigator) {
      notificationRegistration = await navigator.serviceWorker.ready;
    }
    if (notificationRegistration?.showNotification) {
      await notificationRegistration.showNotification(title, {
        body: state.preview ? body : "You have a new Cocoon notification.",
        tag: "cocoon",
        renotify: true,
        silent: !state.sound,
        data: { url: "/" }
      });
    }
  } catch {}
}

function getAudioContext() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch { return null; }
}

function playTone(kind = "message") {
  const c = getAudioContext();
  if (!c) return false;
  try {
    const now = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(kind === "call" ? 880 : 660, now);
    o.frequency.exponentialRampToValueAtTime(kind === "call" ? 660 : 520, now + 0.18);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.06, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
    o.connect(g); g.connect(c.destination);
    o.start(now); o.stop(now + 0.21);
    return true;
  } catch { return false; }
}

function beep() {
  playTone("message");
}

function startRingtone() {
  stopRingtone();
  playTone("call");
  ringtoneTimer = setInterval(() => playTone("call"), 1000);
}

function stopRingtone() {
  if (ringtoneTimer) {
    clearInterval(ringtoneTimer);
    ringtoneTimer = null;
  }
}


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
["click", "keydown", "touchstart"].forEach(evt => document.addEventListener(evt, () => {
  getAudioContext();
  resetIdleTimer();
}, { passive: true }));
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.autoLock && localStorage.getItem(PIN_KEY)) lockApp("hidden");
});
window.addEventListener("focus", resetIdleTimer);
if (matchMedia) matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", applyTheme);
render();
