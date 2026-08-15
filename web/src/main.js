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
  messages: [],
  call: { pc: null, stream: null, remote: null, kind: null, peer: null, initiator: false }
};

const app = document.querySelector("#app");
const esc = v => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[c]));

function render() {
  document.documentElement.dataset.theme = state.theme;
  app.innerHTML = `
    <main class="shell">
      <header class="top"><div><div class="brand">COCOON</div><div class="sub">Private 1-to-1 messenger</div></div><button id="settings">Settings</button></header>
      <section class="layout">
        <aside class="panel users">
          <label>Your ID<input id="me" value="${esc(state.me)}" placeholder="e.g. alice" maxlength="64"></label>
          <label>Peer ID<input id="peer" value="${esc(state.peer)}" placeholder="e.g. bob" maxlength="64"></label>
          <button id="connect">Connect</button><div class="status" id="status">Offline</div>
          <div class="privacy">Messages are encrypted before transport. The server relays ciphertext.</div>
        </aside>
        <section class="panel chat">
          <div class="chathead"><div><b>${esc(state.peer || "Select a peer")}</b><small>1-to-1</small></div><div class="calls"><button id="voice">Voice</button><button id="video">Video</button></div></div>
          <div id="messages" class="messages"></div>
          <form id="send"><input id="text" autocomplete="off" placeholder="Write a message…"><button>Send</button></form>
        </section>
      </section>
      <dialog id="settingsDlg"><h2>Privacy & appearance</h2>
        <label>Theme<select id="theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label class="row"><input id="sound" type="checkbox"> Notification sound</label>
        <button id="notify">Enable notifications</button><button id="lockNow">Lock now</button><button id="closeDlg">Close</button>
      </dialog>
      <div id="incoming" class="overlay hidden"><div class="callbox"><h2 id="incomingTitle">Incoming call</h2><p id="incomingFrom"></p><div class="callactions"><button id="acceptCall">Accept</button><button id="rejectCall">Reject</button></div></div></div>
      <div id="call" class="overlay hidden"><div class="callbox active"><h2 id="callTitle">Call</h2><video id="remoteVideo" autoplay playsinline></video><video id="localVideo" autoplay muted playsinline></video><p id="callStatus">Connecting…</p><button id="endCall">End call</button></div></div>
      <div id="lock" class="lock ${state.locked ? "" : "hidden"}"><div class="lockbox"><div class="brand">COCOON</div><p>App locked</p><input id="pin" type="password" inputmode="numeric" maxlength="12" placeholder="PIN"><button id="unlock">Unlock</button><small id="lockMsg"></small><button id="setPin" class="link">Set / change PIN</button></div></div>
    </main>`;

  document.querySelector("#me").oninput = e => state.me = e.target.value.trim();
  document.querySelector("#peer").oninput = e => state.peer = e.target.value.trim();
  document.querySelector("#connect").onclick = connect;
  document.querySelector("#send").onsubmit = send;
  document.querySelector("#settings").onclick = () => document.querySelector("#settingsDlg").showModal();
  document.querySelector("#closeDlg").onclick = () => document.querySelector("#settingsDlg").close();
  document.querySelector("#theme").value = state.theme;
  document.querySelector("#theme").onchange = e => { state.theme=e.target.value; localStorage.setItem("cocoon_theme",state.theme); render(); };
  document.querySelector("#sound").checked = state.sound;
  document.querySelector("#sound").onchange = e => { state.sound=e.target.checked; localStorage.setItem("cocoon_sound",state.sound?"on":"off"); };
  document.querySelector("#notify").onclick = enableNotifications;
  document.querySelector("#lockNow").onclick = () => { state.locked=true; render(); };
  document.querySelector("#unlock").onclick = unlock;
  document.querySelector("#setPin").onclick = setPin;
  document.querySelector("#voice").onclick = () => startCall("voice");
  document.querySelector("#video").onclick = () => startCall("video");
  document.querySelector("#acceptCall").onclick = acceptIncoming;
  document.querySelector("#rejectCall").onclick = rejectIncoming;
  document.querySelector("#endCall").onclick = endCall;
  drawMessages();
}

function drawMessages(){const box=document.querySelector("#messages");if(!box)return;box.innerHTML=state.messages.map(m=>`<div class="msg ${m.from===state.me?"mine":""}"><span>${esc(m.text)}</span><small>${esc(m.from)}</small></div>`).join("");box.scrollTop=box.scrollHeight;}

async function digest(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
async function setPin(){const p=prompt("Choose a PIN (6–12 characters):");if(!p||p.length<6||p.length>12)return alert("Use 6–12 characters.");localStorage.setItem("cocoon_pin_hash",await digest("cocoon:"+p));state.locked=false;render();}
async function unlock(){const p=document.querySelector("#pin").value;const expected=localStorage.getItem("cocoon_pin_hash");const actual=await digest("cocoon:"+p);if(expected&&actual===expected){state.locked=false;render();}else document.querySelector("#lockMsg").textContent="Incorrect PIN.";}

function connect(){
  if(!state.me||!state.peer)return alert("Enter both IDs.");
  localStorage.setItem("cocoon_user",state.me); if(state.socket)state.socket.disconnect();
  state.socket=io(SERVER,{transports:["websocket","polling"]});
  state.socket.on("connect",()=>{state.socket.emit("register",state.me);const s=document.querySelector("#status");if(s)s.textContent="Connected";});
  state.socket.on("message",async packet=>{try{const text=await decrypt(packet.ciphertext,packet.iv,state.me);state.messages.push({from:packet.from,text});drawMessages();if(state.sound)beep();}catch{}});
  state.socket.on("call-incoming",data=>incomingCall(data));
  state.socket.on("call-response",data=>{if(data.action==="accept")createPeerConnection(true);else if(data.action==="reject"){closeCallUI();alert("Call rejected.");}});
  state.socket.on("webrtc",async packet=>{if(packet.from!==state.call.peer)return;await handleSignal(packet.data);});
  state.socket.on("call-end",()=>{closePeer();closeCallUI();});
  state.socket.on("session-replaced",()=>{const s=document.querySelector("#status");if(s)s.textContent="Session replaced";});
  state.socket.on("connect_error",()=>{const s=document.querySelector("#status");if(s)s.textContent="Server unavailable";});
}

async function keyFor(a,b){return crypto.subtle.importKey("raw",new TextEncoder().encode((a<b?a+":"+b:b+":"+a).padEnd(32,"0").slice(0,32)),{name:"AES-GCM"},false,["encrypt","decrypt"]);}
async function encrypt(text,from,to){const key=await keyFor(from,to),iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(text));return{ciphertext:btoa(String.fromCharCode(...new Uint8Array(data))),iv:btoa(String.fromCharCode(...iv))};}
async function decrypt(ciphertext,iv64,me){const key=await keyFor(state.peer,me),iv=Uint8Array.from(atob(iv64),c=>c.charCodeAt(0)),data=Uint8Array.from(atob(ciphertext),c=>c.charCodeAt(0));return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv},key,data));}
async function send(e){e.preventDefault();if(!state.socket?.connected)return alert("Connect first.");const input=document.querySelector("#text"),text=input.value.trim();if(!text)return;const enc=await encrypt(text,state.me,state.peer);state.socket.emit("message",{to:state.peer,...enc});state.messages.push({from:state.me,text});input.value="";drawMessages();}

async function startCall(kind){
  if(!state.socket?.connected)return alert("Connect first.");
  if(!navigator.mediaDevices?.getUserMedia)return alert("This browser does not support microphone/camera access.");
  state.call={...state.call,kind,peer:state.peer,initiator:true};
  showCallUI(kind,"Waiting for answer…");
  state.socket.emit("call-start",{to:state.peer,kind});
  if(state.sound)ringTone();
}
function incomingCall(data){state.call.kind=data.kind;state.call.peer=data.from;showIncoming(data);if(state.sound)ringTone();}
function showIncoming(data){document.querySelector("#incomingTitle").textContent=`Incoming ${data.kind} call`;document.querySelector("#incomingFrom").textContent=`From ${data.from}`;document.querySelector("#incoming").classList.remove("hidden");}
async function acceptIncoming(){document.querySelector("#incoming").classList.add("hidden");state.call.initiator=false;state.socket.emit("call-response",{to:state.call.peer,action:"accept"});await createPeerConnection(false);}
function rejectIncoming(){document.querySelector("#incoming").classList.add("hidden");state.socket.emit("call-response",{to:state.call.peer,action:"reject"});state.call.peer=null;}

async function createPeerConnection(initiator){
  if(state.call.pc)closePeer();
  const kind=state.call.kind;state.call.pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  const pc=state.call.pc;
  pc.onicecandidate=e=>{if(e.candidate)state.socket.emit("webrtc",{to:state.call.peer,data:{type:"ice",candidate:e.candidate}});};
  pc.ontrack=e=>{const v=document.querySelector("#remoteVideo");if(v)v.srcObject=e.streams[0];};
  pc.onconnectionstatechange=()=>{const s=document.querySelector("#callStatus");if(s)s.textContent=pc.connectionState; if(["failed","closed","disconnected"].includes(pc.connectionState))closePeer();};
  try{
    const stream=await navigator.mediaDevices.getUserMedia(kind==="video"?{audio:true,video:true}:{audio:true,video:false});
    state.call.stream=stream;stream.getTracks().forEach(t=>pc.addTrack(t,stream));
    const local=document.querySelector("#localVideo");if(local){local.srcObject=stream;local.style.display=kind==="video"?"block":"none";}
    if(initiator){const offer=await pc.createOffer();await pc.setLocalDescription(offer);state.socket.emit("webrtc",{to:state.call.peer,data:{type:"offer",sdp:pc.localDescription}});showCallUI(kind,"Calling…");}
  }catch(err){alert(`Could not access ${kind} device: ${err.message}`);endCall();}
}
async function handleSignal(data){
  if(!state.call.pc && data.type!=="offer")return;
  const pc=state.call.pc;
  if(data.type==="offer"){
    if(!state.call.pc)await createPeerConnection(false);
    await pc.setRemoteDescription(data.sdp);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);state.socket.emit("webrtc",{to:state.call.peer,data:{type:"answer",sdp:pc.localDescription}});
  }else if(data.type==="answer"){await pc.setRemoteDescription(data.sdp);}else if(data.type==="ice"){try{await pc.addIceCandidate(data.candidate);}catch{}}
}
function showCallUI(kind,status){document.querySelector("#callTitle").textContent=kind==="video"?"Video call":"Voice call";document.querySelector("#callStatus").textContent=status;document.querySelector("#call").classList.remove("hidden");}
function closeCallUI(){document.querySelector("#call")?.classList.add("hidden");document.querySelector("#incoming")?.classList.add("hidden");}
function closePeer(){if(state.call.stream)state.call.stream.getTracks().forEach(t=>t.stop());if(state.call.pc)state.call.pc.close();state.call.pc=null;state.call.stream=null;}
function endCall(){if(state.socket?.connected&&state.call.peer)state.socket.emit("call-end",{to:state.call.peer});closePeer();closeCallUI();state.call={pc:null,stream:null,remote:null,kind:null,peer:null,initiator:false};}

async function enableNotifications(){if(!("Notification"in window))return alert("Notifications are not supported here.");const p=await Notification.requestPermission();alert(`Notification permission: ${p}`);}
function beep(){try{const c=new AudioContext(),o=c.createOscillator(),g=c.createGain();o.frequency.value=660;g.gain.value=.03;o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.08);}catch{}}
function ringTone(){try{const c=new AudioContext(),o=c.createOscillator(),g=c.createGain();o.type="sine";o.frequency.value=880;g.gain.value=.03;o.connect(g);g.connect(c.destination);o.start();setTimeout(()=>{o.stop();c.close();},350);}catch{}}

document.addEventListener("visibilitychange",()=>{if(document.hidden&&localStorage.getItem("cocoon_pin_hash")){state.locked=true;render();}});
render();
