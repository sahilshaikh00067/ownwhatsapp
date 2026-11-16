# Production readiness and outstanding campaign controls

## Status

Production deployment is not safe yet. Bulk WhatsApp dispatch and DP campaign dispatch are disabled in the panel. No live send/provider operation was performed. The Render Node health probe timed out, so the deployed service and entrypoint could not be verified.

## Login security configuration

- `DJANGO_SECRET_KEY`: required, high-entropy, stable across Django workers. The repository's insecure development fallback must never be used in production.
- `DATABASE_URL`: required for PostgreSQL. Keep test runs pointed at a disposable database.
- `PANEL_TOKEN_MAX_AGE`: token lifetime in seconds; current default is 86400. Password changes increment `User.token_version`, invalidating existing tokens on both legacy and provider routes.
- `PANEL_LOGIN_RATE`: login-only, database-backed per-IP attempt limit; default `20/min`. It is a fixed one-minute window, not a permanent user lockout.
- `PANEL_TRUSTED_PROXY_COUNT`: unset means Django REST Framework uses `REMOTE_ADDR`. Set a number only after confirming the hosting proxy strips/overwrites caller-supplied `X-Forwarded-For` and establishing the exact trusted proxy count. A wrong value can collapse users into one bucket or let clients spoof IPs.

The throttle stores an HMAC digest of the client identity, not the IP itself. The database table is created by the Django migration. Monitor throttling and revise the rate only from production traffic evidence.

## Callback and provider configuration

- `CAMPAIGN_CALLBACK_SECRET`: strong random value, at least 32 characters, present only in Django and the actual Node sender. The callback uses timestamped HMAC-SHA256 request signing; do not expose this key to Vercel or React.
- Node callback URL: proposed environment name `CAMPAIGN_CALLBACK_URL`, set to the Django `/api/campaigns/callback/` URL only after the actual Node service is identified and implemented.
- Provider integration credentials: `WBOX_API_BASE_URL`, `WBOX_API_TOKEN`, `WBOX_META_VERSION`, `WBOX_WABA_ID`, `WBOX_PHONE_NUMBER_ID`, and `WBOX_WEBHOOK_SECRET` as required by the chosen provider operations. Values belong in the Django secret manager. They were not read or printed during this review.

## Node and campaign dispatch

The checked-in sender package is `backend/package.json`, whose start command is `node server.js`. `backend/server.js` has a real `/send-single` route that requires a device ID and sends text through the selected in-memory WhatsApp client. It has no `/send-bulk` route. The React bulk request sends no device ID and can include media that `/send-single` does not handle. The device map has no documented mapping from authenticated Django users to device IDs. Therefore the bulk route cannot safely be inferred from the checked-in route, and the actual Render service remains unverified.

The React WappCampaign and WappDpCampaign submission handlers now stop before Django reservation or Node dispatch. Django `/api/send-whatsapp/` also fails closed with `503` by default (`CAMPAIGN_DISPATCH_ENABLED = False`), before making a reservation or credit change. Tests turn this setting on only to exercise reservation and callback accounting. Do not re-enable campaign creation until service identity, recipient/device ownership, media handling, queue/approval policy, dispatch idempotency, and callback delivery have been verified and tested using mocks/staging.

`API_KEY` exists in the Node source but is optional; the middleware explicitly allows the React app and `/app` without that header. Before production, verify the deployed Node network/access controls and device endpoint authentication. Do not flip this setting without a compatible QR/device client plan.

## Migration 0017 production backfill gate

The historical Django `send_whatsapp` implementation deducted credits from non-admin users for new campaigns and labeled its credit log `Campaign queued` for pending campaigns. Migration `0017` accordingly marks every pending campaign owned by a reseller/user as `credit_reserved=True`. This supports the backfill premise, but it does not prove the production rows: the historical debit, campaign insert, and credit log were not all one atomic operation, and `CreditLog` has no campaign foreign key.

Before applying migration `0017` to production, run read-only queries on a verified production snapshot and reconcile pending campaigns and credit history by user, campaign, amounts, result metadata, and timestamps. The following inventory is only a starting point; it cannot prove one-to-one campaign-to-ledger attribution:

```sql
SELECT u.role, c.status, COUNT(*) AS campaigns, SUM(c.total) AS recipients
FROM api_campaign c
JOIN api_user u ON u.id = c.user_id
WHERE c.status = 'pending' AND u.role IN ('reseller', 'user')
GROUP BY u.role, c.status;

SELECT user_id, COUNT(*) AS queued_debit_rows, SUM(credit) AS queued_debits
FROM api_creditlog
WHERE type = 'Debit' AND notes = 'Campaign queued'
GROUP BY user_id
ORDER BY user_id;
```

Do not execute the migration until the DBA/product owner confirms that every pending non-admin campaign corresponds to an outstanding debit, and resolves unmatched or ambiguous rows. Never perform this comparison by running Django tests against production.

## Render and Vercel deployment sequence (after blockers are cleared)

1. Review and approve the branch diff and reconcile the branch ancestry. Do not deploy from the unresolved original worktree.
2. Validate `0017` against a production snapshot; then create a fresh backup and take an approved maintenance window for migrations.
3. Configure the Django Render service with root `backend`, Python requirements from `backend/requirements.txt`, a production WSGI start command, `DJANGO_SECRET_KEY`, PostgreSQL `DATABASE_URL`, approved CORS/hosts, throttle/proxy settings, provider keys, and callback HMAC secret. Keep `DEBUG=False`.
4. Configure the actual Node Render service only after its repository, branch, root directory, and running commit are confirmed. Use Node 20 and `npm start`; configure Chrome/Puppeteer paths only from deployment evidence. Attach persistent storage and set `SESSIONS_DIR` to its mount path so QR sessions survive restarts. Configure no bulk sender until ownership, device mapping, route auth, and callback behavior are implemented and tested.
5. Deploy to staging first. Verify login/token revocation, migrations, provider operations with mocked or provider-approved test credentials, callback signatures/idempotency, sender status transitions, QR login/session persistence, and reports. No production recipients should be used for these checks.
6. Configure Vercel from the repository root with `npm run build` and output directory `dist`. Set `VITE_DJANGO_API_URL` to the approved Django service URL for provider UI calls. Existing legacy UI and Node service URLs are hard-coded in several components; update them consistently only after service URLs are confirmed. Keep `vercel.json` SPA routing and verify the exact allowed origin in Django CORS/CSRF settings.
7. Proceed to production only after the sender and DP contract blockers below are closed, all checks pass on a disposable PostgreSQL test database, and the release has explicit approval.

## Remaining business and operations decisions

- Identify the deployed Node service and its actual source commit/entrypoint; confirm whether it differs from checked-in `backend/server.js`.
- Define the verified user-to-device ownership mapping and bulk/media behavior.
- Confirm admin approval behavior and define how uncertain sends are reconciled. Timeouts remain pending with credits reserved; no auto-refund or resend is safe.
- Define DP persistence, billing, recipient result, reporting, and action-button behavior before implementing `/api/update-dp/`.
- Validate historical pending campaign rows and credit logs before production migration `0017`.
