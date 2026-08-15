# Cocoon Private Messenger

An editable 1-to-1 messenger starter with Socket.IO signalling, client-side AES-GCM transport encryption, PIN lock, themes, and a WebRTC voice/video call path.

## Current implementation
- 1-to-1 real-time chat through Socket.IO
- Client-side AES-GCM message encryption for the demo transport
- App Lock with PBKDF2-based PIN verifier, manual lock, 5-minute inactivity lock, and lock-on-hidden
- Light/dark/system theme with persistence and system-theme detection
- Message and call sounds with an enable/disable control
- Browser notifications with privacy-preserving message previews disabled by default
- Service-worker notification click handling
- Incoming-call UI
- WebRTC voice/video media path using STUN signalling
- Call accept/reject/end
- The Node server relays signalling and ciphertext; it does not intentionally store chat plaintext

## App Lock and notification notes
- App Lock is a web-app privacy barrier. It is not equivalent to Android Keystore/biometric protection.
- The lock disconnects the Socket.IO session and ends an active call when it engages.
- Notification message previews are disabled by default; enabling them can expose message text to the operating system notification surface.
- Browser notification delivery is subject to browser/OS permission, background execution, and power-management rules. This starter does not implement Web Push or a native Android notification service.

## Important security limitation
This is **not a production-secure or anonymous messenger**. The demo chat key is derived from the two visible IDs and is not an authenticated E2EE key exchange. The PIN is a UI/local verifier, not a substitute for secure Android keystore-backed protection. WebRTC signalling is not identity-authenticated and the example uses a public STUN server only.

Before calling this private/secure for real use, replace the demo cryptography with an audited E2EE protocol, authenticated identity/key verification, secure local key storage, replay protection, device/session management, authenticated TURN credentials, push notification hardening, rate limits, and an independent security review.

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

Set `VITE_SOCKET_URL` to the HTTPS/WSS-compatible Socket.IO server URL before building the web app.

## Android
A web wrapper does not make every Android version equally capable. Android 4.3-era WebViews do not provide the same WebRTC, TLS, notification, storage, or cryptographic APIs as modern Android. A security-sensitive release should set a supported minimum version after compatibility/security testing rather than promising Android 4.3–14 equivalence.
