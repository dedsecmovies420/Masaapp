# Security checklist

Before calling Cocoon a private messenger:

- [ ] Use HTTPS/WSS only in production.
- [ ] Replace demo identity/authentication with a real account system.
- [ ] Use an audited E2EE protocol/library.
- [ ] Authenticate the key exchange and verify safety numbers/fingerprints.
- [ ] Never send message plaintext to the server.
- [ ] Encrypt sensitive local storage.
- [ ] Keep encryption keys out of normal localStorage.
- [ ] Add replay protection and message sequence handling.
- [ ] Use WebRTC for media; never send media through the chat database.
- [ ] Use authenticated TURN credentials for calls.
- [ ] Avoid sensitive notification previews.
- [ ] Add rate limits and abuse protection.
- [ ] Add session/device revocation.
- [ ] Perform dependency and security audits before release.
