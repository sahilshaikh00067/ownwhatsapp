# Provider API integration

The Omni Channel Panel calls the WABOX APIs through Django. The React app does not receive the provider token. Django issues a signed panel session token after the existing login succeeds; provider endpoints require that token. The token is separate from the WABOX bearer credential and expires after `PANEL_TOKEN_MAX_AGE` seconds (default 86,400).

## Server configuration

Configure these variables in the Django service environment/secret manager. Do not put secret values in source control.

| Variable | Purpose |
| --- | --- |
| `WBOX_API_BASE_URL` | Provider base URL; defaults to `https://wbbox.infrainfotech.com` |
| `WBOX_API_TOKEN` | WABOX bearer credential |
| `WBOX_META_VERSION` | Meta Graph version, such as the provider account's supported `vN.N` |
| `WBOX_WABA_ID` | WABA identifier used for template management |
| `WBOX_PHONE_NUMBER_ID` | Phone number identifier used for sending and media upload |
| `WBOX_WEBHOOK_SECRET` | Separate shared secret for the inbound callback receiver |
| `PANEL_TOKEN_MAX_AGE` | Signed panel token lifetime in seconds |
| `ADMIN_SETUP_TOKEN` | One-time bearer secret for initial admin creation via `POST /api/setup-admin/` |
| `ADMIN_SETUP_PASSWORD` | Initial admin password; used only if the configured admin does not already exist |
| `ADMIN_SETUP_USERNAME` | Optional initial admin username; defaults to `admin` |

`backend/.env.example` lists the variable names with blank secret values. Django reads process environment variables; it does not automatically load that file.
Newly created or changed passwords are hashed, and a legacy plaintext password is upgraded after a successful login. Configure admin bootstrap values only for initial setup and remove them afterward.

## Panel API routes

All provider routes below use `Authorization: Bearer <panel_token>` except the inbound webhook, which uses `WBOX_WEBHOOK_SECRET`.

All provider dashboard/API routes require an active admin account because the configured provider credential addresses a shared WABA. The separate inbound webhook uses only its configured shared secret.

- `GET /api/provider/status/`
- `POST /api/provider/dispatch/` with `operation`: `balance`, `clevertap`, `moengage`, `webengage`, or `webhook`
- `GET /api/provider/templates/` with `page`, `limit`, `start_date`, `end_date`, and/or `template_name`
- `GET /api/provider/templates/{template_id}/`
- `POST /api/provider/templates/sync/` with optional ISO 8601 `startDate` and `endDate`
- `GET|POST|DELETE /api/provider/meta/templates/`
- `GET /api/provider/meta/resource/{id}/` with optional `phone_number_id`
- `POST /api/provider/meta/template/{template_id}/`
- `GET /api/provider/meta/channels/`
- `POST /api/provider/meta/messages/`
- `POST /api/provider/meta/media/` as multipart field `file`
- `POST /api/provider/webhook/inbound/` for authenticated provider callbacks

A `ProviderTemplateCache` stores provider template metadata, `ProviderSyncState` stores sync status, `ProviderApiAudit` stores operation/method/status metadata without request payloads, and `ProviderWebhookEvent` stores only event ID/type metadata. No bearer authorization value or webhook message body is stored in any model.

## Verification status

Automated tests mock the WABOX server and exercise every one of the 16 documented provider operations, validation failures, authentication, inbound webhook authentication, provider errors, and network failures. This verifies our Django routing and request construction; it is not a live provider certification.

Live provider checks are **not run** unless the server has valid WABOX credentials and account IDs. The credential shown in the uploaded sample commands was not reused. The sample document reports errors for several calls, but some examples omit required path IDs or bodies. The missing request schemas for CleverTap, MoEngage, WebEngage, messages, and webhooks need provider-specific valid payloads. Live message send, template create/edit/delete, media upload, and webhook operations can create external side effects, so perform those only with a provider sandbox and approved test data.

## Existing authentication boundary

The new provider routes require signed panel tokens and admin role checks. Existing non-provider Django routes retain their prior authorization behavior: several user CRUD, campaign, and credit endpoints accept caller-supplied `user_id` values without validating the signed panel token or consistently enforcing the caller's role. This remains a production security blocker and needs a separate compatibility-aware authorization pass before deployment. Existing plaintext passwords are upgraded after a successful login; legacy accounts that have not logged in still need a controlled password reset or migration plan.

Run locally from `backend/`:

```powershell
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test
```

