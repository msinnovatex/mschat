# Deployment Guide

## Local setup
1. Use Node.js 22.x.
2. Run `npm install`.
3. Copy `.env.example` to `.env`; use placeholders only in source control.
4. Set `ALLOWED_ORIGINS=http://localhost:5173` locally and exact HTTPS origins in Vercel.
5. Set `OTP_HMAC_SECRET` to at least 32 cryptographically random bytes. Keep it stable across deployments so outstanding OTP digests remain valid.
6. Run `npm test`, then `npm run build`.

## Firebase
1. Create a dedicated Firebase project and Realtime Database.
2. Apply `firebase.rules.json`; confirm unauthenticated client reads/writes are denied.
3. Create a dedicated service account with least privilege.
4. Add database URL, project ID, service-account email and private key to Vercel server-side variables.
5. Keep all application paths under `mschat/`. Do not put service-account keys in RTDB.

## Gmail API
1. Enable Gmail API and configure OAuth consent.
2. Generate a refresh token with `gmail.send` scope.
3. Configure `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` and `GMAIL_SENDER_EMAIL`.
4. Test registration and admin OTP delivery using a real mailbox. CI does not prove delivery.

## Cloudflare R2
1. Create a dedicated private bucket for MS Chat.
2. Add account ID, access key, secret and bucket name to server-side variables.
3. Configure bucket CORS for exact app origins and required PUT/GET/HEAD methods and Content-Type header.
4. Keep keys under `mschat/attachments/` and `mschat/profile-images/`; do not configure a public bucket.
5. Grant the R2 token permission to list objects for the bucket/prefix if you want the admin storage inventory to work; the inventory scans only the `mschat/` prefix.
5. Test upload, complete, download, profile image replacement, deletion and cleanup against real R2. Attachment upload is not resumable.

## Web Push
Generate VAPID keys with `npx web-push generate-vapid-keys`. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and a valid `VAPID_SUBJECT`. Test on target browsers; support varies by platform.

## Admin bootstrap
1. Register and verify the intended administrator account.
2. Set `ADMIN_EMAIL` and a long random `ADMIN_BOOTSTRAP_SECRET`.
3. Sign in and visit `/admin.html`; enter the bootstrap secret once.
4. Remove or rotate the bootstrap secret in every Vercel environment immediately after success.
5. Administrator login requires password plus email OTP. Protect the mailbox and OAuth credentials.

## Vercel
1. Import the repository and select the intended branch.
2. Configure Preview and Production environment variables separately.
3. Confirm Node.js 22.x runtime, HTTPS, exact origins, and cron authentication.
4. Configure `CRON_SECRET` and ensure scheduled cleanup invokes the cleanup route with `Authorization: Bearer <CRON_SECRET>`.
5. Deploy only after CI passes, then verify `/api/health`, registration, login persistence, logout, friend requests, messaging, R2, push and cleanup with real services.

## Operational notes
Historical counters are not initialized automatically; dashboard metrics are tracked only since their recorded start time. Account deletion currently queues a pending request but does not finish all data cleanup. Do not run destructive migrations without backup and rollback plans.


## One-time historical admin-metrics backfill

The dashboard's registration, message and report counters may have started after the app already had data. The script `scripts/backfill-admin-metrics.mjs` adds counts for extant records created before each counter's tracking start. It is idempotent per counter and does not delete data. It cannot reconstruct already-deleted records, expired attachment uploads or historical API errors.

1. Take a Firebase Realtime Database backup.
2. Put server-side Firebase Admin credentials in a local, untracked `.env` file (never commit it).
3. Run a dry run first: `npm run metrics:backfill`.
4. Inspect the planned additions and confirm the Firebase project is the intended project.
5. Only after reviewing the output, run `npm run metrics:backfill -- --apply`.
6. Verify the dashboard and retain the script output with your deployment notes.

The script scans existing user/report records and each conversation's message records; run it during low traffic. Do not run it concurrently from multiple machines.
## Non-destructive deployment smoke/load check

After deployment, run a bounded unauthenticated smoke check against the deployed origin:

```sh
MSCHAT_BASE_URL=https://your-app.vercel.app npm run smoke:load
```

Optional bounds: `MSCHAT_SMOKE_REQUESTS=20` (maximum 500) and `MSCHAT_SMOKE_CONCURRENCY=5` (maximum 20). It checks `GET /api/health` and verifies that `GET /api/auth/me` rejects an unauthenticated request with 401, then reports latency percentiles. This is a small smoke/load probe only, not a production capacity test or proof that authenticated messaging, Gmail, R2, Firebase writes, or Web Push work.
