# Cocoon Private Messenger — v3

A 1-to-1 messenger starter with Socket.IO signalling, client-side encrypted message transport, App Lock, themes, browser notifications, sound controls, and a WebRTC voice/video call path.

## Included
- 1-to-1 chat UI
- Socket.IO realtime transport
- Client-side AES-GCM message encryption
- App Lock PIN verifier with PBKDF2 on supported Web Crypto implementations
- Light/dark/system theme
- Browser notification permission flow
- Message/call sound controls
- WebRTC voice/video signalling and peer media path
- Server-side validation, payload limits and basic rate limiting
- `/health` endpoint

## Deploy
See `docs/DEPLOY-V3.md`.

## Important security limitation
Do **not** market this build as "100% private", "unbreakable", or production-secure. The current message key is derived from the two visible IDs, so it is not a complete authenticated E2EE protocol and does not provide forward secrecy. The signalling server can also relay WebRTC signalling messages. Production use requires an audited E2EE protocol, authenticated identity/key verification, secure Android key storage, replay protection, session/device management, authenticated TURN, hardened push notifications, dependency review, penetration testing and an independent security audit.

## Android compatibility
This repository is a web application. It is not a native Android project and therefore does not by itself guarantee Android 4.3–14 compatibility. For reliable background notifications, incoming calls, secure key storage and OS-level App Lock, a native Android client (or a carefully designed Android wrapper) is required. Choose and test a security-supported minimum Android version rather than claiming every Android release is equally secure.
