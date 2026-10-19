# MS Chat delivery audit — 2026-10-19

## Scope and evidence

This is a source-level audit of the current `main` branch against `command.txt`, focused on the authentication/session path, API routing, deployment configuration, database rules, crypto implementation, attachment authorization, account deletion, and existing test setup. It is not a complete penetration test or proof that external services work.

## Changes made in this pass

- Fixed `lib/core.js`: `issueSession()` previously returned `tokenHash` before setting the `mschat_session` cookie, making the cookie assignment unreachable. It now sets the cookie before returning.
- Added exported `sessionCookieHeader()` helper and a regression test in `test/core.test.js` for the persistent HttpOnly/SameSite cookie attributes.
- Fixed `lib/handlers/profile.js`: the profile-update response now returns the authenticated profile-image route when an R2 image key exists, matching the profile GET response.

## Blocking gaps before claiming full acceptance

1. **E2EE does not meet the command's acceptance criteria.** `src/chat-crypto.js` uses static ECDH/HKDF/AES-GCM and local fingerprint pinning. It is not a reviewed Signal Protocol implementation and does not provide forward secrecy, ratcheting, post-compromise recovery, authenticated first contact/key transparency, or secure multi-device key recovery. Do not market this as Signal/WhatsApp-equivalent E2EE.
2. **Account deletion is incomplete.** `lib/handlers/account.js` disables the account and queues a request, but the cleanup worker does not process the full account-deletion workflow across user-linked RTDB records, relationships, message retention policy, profile objects, and indexes. The request must not be represented as completed deletion.
3. **Attachment validation has a trust boundary gap.** File signature and video-duration checks occur in the sender's browser before encryption; a malicious client can bypass them. Uploads are not resumable. Do not treat client validation as a server-side security control.
4. **Production integration verification is missing.** Real Gmail OTP delivery, Firebase authorization behavior via Emulator, R2 upload/download/cleanup, and Web Push delivery have not been verified in this pass.
5. **Security and performance verification is incomplete.** No independent penetration test, dependency audit report, or realistic load test has been completed.
6. **Metrics are partial.** Historical admin counters are not backfilled and provider-level storage/bandwidth metrics are not available.
7. **Automated test execution is unverified in this environment.** The GitHub status endpoint returned no check statuses for the inspected commits, and this environment could not clone the repository to run `npm test` or `npm run build` locally. Do not infer passing tests from source inspection.

## Deployment checklist

Before client handover, configure real values in Vercel (Preview and Production separately): Firebase Admin credentials and database URL, `OTP_HMAC_SECRET`, Gmail OAuth values, private R2 credentials/bucket, VAPID keys, exact `ALLOWED_ORIGINS`, `APP_BASE_URL`, `CRON_SECRET`, `ADMIN_EMAIL`, and one-time `ADMIN_BOOTSTRAP_SECRET`. Apply `firebase.rules.json`; verify direct client reads/writes are denied. After admin bootstrap, remove/rotate the bootstrap secret.

## Release decision

**Not ready to certify as 100% complete against `command.txt`.** The session-cookie defect was fixed in this pass, but the E2EE protocol and account-deletion workflow are release blockers, and external integrations/tests still need real verification. A successful frontend build alone would not resolve these blockers.
