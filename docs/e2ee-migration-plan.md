# MS Chat E2EE protocol migration decision

Status: **BLOCKED — do not describe the current crypto as production-grade end-to-end encryption.**

## Current implementation

`src/chat-crypto.js` currently derives a static AES-GCM key from long-lived P-256 ECDH identity keys and HKDF. It stores device private keys in IndexedDB and warns on a changed locally pinned remote fingerprint. This is a custom protocol design and does not provide a reviewed ratchet, forward secrecy for historical messages, or post-compromise recovery.

## Library assessment

- The official `@signalapp/libsignal-client` package is AGPL-3.0-only. Its upstream README describes Node/native package builds, not a supported browser distribution contract. Do not bundle it into the Vite frontend without a legal/license decision and a working browser compatibility spike.
- `@privacyresearch/libsignal-protocol-typescript` is a third-party implementation. Upstream issues include a report about an un-awaited identity-trust check in session setup. It must not be adopted as a drop-in security fix without code review, maintenance assessment, protocol/version support checks, and security testing.
- No alternative has been approved in this repository yet. Selecting an unverified library just to remove the blocker would trade a documented limitation for an unverified security claim.

References:
- https://github.com/signalapp/libsignal
- https://www.npmjs.com/package/@signalapp/libsignal-client
- https://github.com/privacyresearchgroup/libsignal-protocol-typescript/issues/92

## Required migration stages

1. Record the license and deployment constraints and build a minimal browser compatibility proof of concept in an isolated branch.
2. Select a maintained implementation that explicitly supports the browser target and provides identity keys, authenticated session establishment, ratcheting, replay/tamper protection, and test vectors.
3. Design server APIs for public identity/prekey material only. Keep private keys and private session state on the client; validate one-time prekey consumption atomically.
4. Persist protocol state safely in IndexedDB, handle multiple tabs/devices, browser storage loss, identity changes, and key backup without silently replacing identity keys.
5. Add cross-client protocol test vectors, adversarial tests, replay tests, key-change tests, and a compatibility/downgrade plan for existing messages.
6. Remove or clearly segregate the legacy static-ECDH protocol. Never silently downgrade a conversation from the reviewed protocol to the legacy scheme.
7. Obtain an independent cryptographic review before making production E2EE claims.

## Release gate

Until these stages are completed and verified, the current encryption remains a **client-side encryption prototype**. Do not claim Signal/WhatsApp-equivalent security or production readiness.
