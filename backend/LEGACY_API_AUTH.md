# Legacy Django API authorization

The legacy panel endpoints use the signed `panel_token` returned by `POST /api/login/`. Send it as `Authorization: Bearer <panel_token>`. `POST /api/login/` remains public; the one-time admin bootstrap route remains protected by its separate server-side setup secret. All other routes in `api/urls.py`, including provider routes and legacy panel routes, require an active account represented by a valid, unexpired signed token.

Tokens include the account's `token_version`. Password resets and password changes increment that version, revoking existing sessions on both legacy and provider API routes. Tokens issued before migration `0018` do not have a version and are rejected after migration.

Login attempts use a database-backed per-IP throttle. The default is `20/min`; `PANEL_LOGIN_RATE` configures the rate. `PANEL_TRUSTED_PROXY_COUNT` must be set only after verifying that the deployed proxy chain sanitizes `X-Forwarded-For`; unset, DRF uses `REMOTE_ADDR`. See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) for deployment details.

## Role and ownership rules

- The signed token is the sole source of the acting account. A supplied `user_id` is a target or consistency check only; it never establishes identity.
- Admins can read and manage accounts and campaigns across the panel. An admin cannot delete or deactivate its own account through the account-management routes.
- Resellers can create `user` accounts, which are always attached to the authenticated reseller regardless of a caller-supplied `parent`. They can read and manage their direct `user` children and their own/children's campaigns. A reseller cannot create or manage another reseller or admin.
- Users can read their own account, users list, credit log and campaigns. They can change their own username/password. They cannot change role, parent, status or credit, or change another account's password.
- A parent must have a higher role than a child. Admins can assign a valid parent during creation or change a child's parent. The implementation uses direct parent/child relationships; it does not infer access to deeper descendants.
- Credit transfers preserve existing behavior: an admin can assign credit without reducing an admin balance; a reseller transfer to a direct child draws from the reseller's balance and a child credit removal returns it. A transfer and its credit log are committed together.
- Campaign credit is reserved and the campaign row is created by Django before the React client calls Node. Only the server-secret callback may finalize the reservation or release credit. Admin campaigns do not debit credits. See [CAMPAIGN_CALLBACK.md](CAMPAIGN_CALLBACK.md) for the request contract and reconciliation rules.

## Behavior requiring product/provider confirmation

- Deleting an account that has children returns `409` until those children are reassigned or removed. The repository did not define whether deleting a reseller should cascade to active customer accounts or transfer them, so this implementation does not guess.
- The current checked-in Node file does not register `/send-bulk`; an older revision did. The deployed service could not be confirmed from the checked-in deployment configuration or read-only probes. `WappDpCampaign.jsx` calls `/api/update-dp/`, but that route is absent from current and historical Django route definitions. The callback contract and missing DP behavior are detailed in [CAMPAIGN_CALLBACK.md](CAMPAIGN_CALLBACK.md).
- Role hierarchy for direct admin-to-user relationships was not documented. Admins can assign a parent only when the parent's role ranks above the child; otherwise the new account is root-level. Confirm whether administrators should always be root accounts and whether admins should be able to create admin accounts.

## Deployment settings and operations

- Set a high-entropy `DJANGO_SECRET_KEY`; legacy panel authentication returns `503` when Django still uses its insecure development key.
- `PANEL_TOKEN_MAX_AGE` controls the login token lifetime in seconds and defaults to `86400`. Coordinate this with frontend session expiry and relogin behavior.
- Keep database, CORS and host settings aligned with the production domains. This change does not relax CSRF middleware or CORS policy.
- After production deployment, verify users log in again so their browser has a `panel_token`; old sessions without it will receive `401`.
- Do not test production messaging or destructive provider operations as part of deployment verification without explicit approval. Test campaign authorization with a stubbed Node sender first.
