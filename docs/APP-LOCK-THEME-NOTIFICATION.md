# App Lock, Theme & Notification workflow

## Completed in this build
- PBKDF2 PIN verifier with random salt (150,000 SHA-256 iterations where Web Crypto PBKDF2 is available).
- Legacy demo PIN verifier can still unlock so existing users are not immediately locked out.
- PIN change requires the current PIN once the new verifier exists.
- Manual lock disconnects the Socket.IO session and stops an active call.
- Auto-lock after 5 minutes of activity inactivity.
- Auto-lock when the document becomes hidden.
- Persistent System/Light/Dark theme, including system theme media-query changes.
- Persistent sound preference.
- Browser notification permission flow.
- Privacy-preserving notification text by default; previews are opt-in.
- Service worker registration and notification-click focus behavior.
- Repeating call ringtone while waiting for an incoming/outgoing call response.

## Verification checklist
1. Set a 6–12 digit PIN.
2. Lock now and verify the lock screen appears.
3. Reload the page and verify it starts locked.
4. Enter the wrong PIN and verify it is rejected.
5. Enter the correct PIN and verify unlock.
6. Change the PIN and verify the old PIN no longer unlocks.
7. Hide the page with auto-lock enabled and verify it locks.
8. Change System/Light/Dark and reload; verify persistence.
9. Enable browser notifications and verify the permission prompt.
10. Leave message preview disabled and verify notifications say only "You have a new message".
11. Enable preview and verify message text is included.
12. Disable sound and verify message/call sounds are suppressed.

## Important platform limitation
Browser notification delivery is not a replacement for native Android push notifications. Reliable background notifications require a native client or a Web Push implementation with a push service and server-side subscription management.
