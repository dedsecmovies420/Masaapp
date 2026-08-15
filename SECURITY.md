# Security status

The repository is a development implementation, not a security-audited private messenger.

## Do not claim
- 100% privacy
- unbreakable security
- anonymous communication
- audited end-to-end encryption

## Required before production
- Audited E2EE protocol/library with authenticated key exchange
- Identity verification/fingerprints and key rotation
- Forward secrecy and post-compromise recovery as provided by the protocol
- Secure Android Keystore-backed key storage; do not keep long-term keys in localStorage
- Secure account/device authentication and revocation
- Replay protection and message sequencing
- HTTPS/WSS everywhere
- WebRTC with authenticated signalling and properly managed STUN/TURN
- Notification privacy and platform permission handling
- Rate limits, abuse controls, dependency scanning and server hardening
- Independent cryptographic/security review and penetration testing
