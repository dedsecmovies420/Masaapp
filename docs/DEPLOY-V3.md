# Cocoon v3 deployment

## Server (Render Web Service)
- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment variable: `ALLOWED_ORIGIN=https://YOUR-WEB-SERVICE.onrender.com`

## Web (Render Static Site)
- Root Directory: `web`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`
- Environment variable: `VITE_SOCKET_URL=https://YOUR-SERVER.onrender.com`

The web service must use the HTTPS Render URL. The browser will then use WSS for Socket.IO automatically.

## What v3 fixes
- Removes the duplicated/broken tail of `web/src/main.js`.
- Keeps App Lock, theme, notifications and sound controls.
- Adds a real remote audio element for voice calls.
- Keeps WebRTC signalling and peer media path.
- Adds server-side input validation, payload limits and a basic per-socket event rate limit.
- Restricts user IDs to a safe character set.
- Does not store message plaintext on the signalling server.

## Security boundary
This is still not a production-grade anonymous messenger. The current message encryption derives a symmetric key from the two visible IDs; that is not an authenticated E2EE protocol and does not provide forward secrecy. For a genuinely security-sensitive messenger, replace it with an audited protocol/library (for example a mature Double Ratchet/MLS implementation), authenticated identity keys, device/session verification, secure key storage, replay protection, and independent security testing.

The browser app also cannot guarantee background notifications on every Android version. Native Android push/notification handling is required for reliable background incoming-call notifications.
