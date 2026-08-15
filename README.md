# Cocoon Private Messenger

A GitHub-ready starter for a private 1-to-1 messenger.

## What is implemented

- 1-to-1 chat UI
- Real-time transport through Socket.IO
- Client-side AES-GCM message encryption for the transport payload
- App PIN lock with PBKDF2-derived verifier
- Auto-lock when the page is hidden
- Light/dark/system theme
- Notification sound toggle
- Call UI placeholders and call-event signalling hooks
- No message plaintext is intentionally stored by the demo server

## Important security limitation

This repository is a **development starter, not a production-secure messenger**.

For production E2EE, authenticated key exchange, identity verification, multi-device key management, secure push notifications, WebRTC TURN/STUN configuration, abuse protection, and an independent security audit are still required.

Do not claim that this app is "unbreakable" or "100% private".

## Run

### Web
```bash
cd web
npm install
npm run dev
```

### Server
```bash
cd server
npm install
npm start
```

The web app expects the Socket.IO server at `http://localhost:8787`.

## GitHub Pages

GitHub Pages can host the `web` frontend, but it cannot run the Node server.
Deploy the `server` separately on a Node-compatible host and set:

`VITE_SOCKET_URL=https://YOUR-SERVER-DOMAIN`

before building the web app.

## Android 4.3–14

The web/PWA layer can be wrapped in an Android shell, but Android 4.3 is legacy.
Modern privacy features such as current biometric APIs, notification behaviour, TLS defaults,
and WebRTC support are not equivalent across Android 4.3–14. For a security-sensitive release,
a higher minimum Android version is strongly recommended.
