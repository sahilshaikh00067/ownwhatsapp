# Trusted Node campaign callback contract

## Current source status

React currently targets `https://ownwhatsapp-backend.onrender.com/send-bulk`. The checked-in Node package is `backend/package.json` (`ownwhatsapp-backend`, start command `node server.js`), and its server is `backend/server.js`. The current file registers `/send-single` but not `/send-bulk`. No Render service manifest is checked in. The frontend URL and package name point to the intended Node service, but they do not prove the deployed Render service is running this source. A read-only live `/health` request timed out, and `OPTIONS /send-bulk` was answered by generic CORS middleware without a route-specific `Allow` header. The live POST contract therefore remains unverified; no POST or message send was attempted.

Older Git revisions did contain `/send-bulk`. In that historical implementation, small sends returned per-number results to the browser, while large requests returned `approval_pending` and later called Django from a timer with simulated results. That code did not show a trustworthy admin approval action and its old Django callback was unauthenticated. It is historical evidence, not a safe production contract to restore unchanged.

## Django callback endpoint

The new server-to-server route is `POST /api/campaigns/callback/`.

Authentication: HMAC-SHA256 over the exact raw JSON body. Send `X-Campaign-Timestamp: <unix-seconds>` and `X-Campaign-Signature: v1=<lowercase-hex-hmac>`, where the signed bytes are `<timestamp>.<raw-request-body>`. Django accepts timestamps within five minutes and compares signatures in constant time. It requires `CAMPAIGN_CALLBACK_SECRET` to be at least 32 characters. The Node service must sign each retry with a fresh timestamp while keeping the same event ID and payload. Never send the secret to React, put it in a query string, or log it.

Request body:

```json
{
  "campaign_id": 42,
  "event_id": "node-job-42:completed",
  "status": "completed",
  "reason": "",
  "results": [
    {"number": "919999999999", "status": "sent", "files": [{"name": "photo.jpg", "type": "image/jpeg"}]}
  ]
}
```

`event_id` must be stable for retries of the same outcome. If an outcome is first reported as unknown and later resolved, use a distinct stable ID for the later outcome, such as `node-job-42:unknown` and `node-job-42:completed`.

- `completed`: persist only whitelisted per-recipient number, status, and file name/type metadata. The existing reservation is consumed; there is no second debit.
- `failed`: requires `reason` `blocked`, `no_device`, or `dispatch_failed`. This means the campaign was definitively not dispatched. If `credit_reserved` is true, release exactly the reserved total and write one credit log.
- `unknown`: requires reason `timeout` or `unknown`. Record the callback event while keeping the campaign pending and its credit reserved. Do not retry the send or release credit based only on a timeout.

Only definitive no-dispatch failures use `failed`. If messages may already have been sent, report `unknown` until their outcome is established. For a completed campaign with a mixture of delivered and failed recipients, return `completed` and per-recipient statuses; current billing charges the reserved total and does not refund individual failed recipients.

Completed callbacks must include exactly one allowed result (`sent`, `failed`, or `nonwa`) for every reserved recipient. Duplicate, missing, malformed, or unreserved recipients are rejected. Definitive no-dispatch failures carry no per-recipient results. Repeated callback with the same event ID and payload returns `200` with `status: duplicate`. Reuse of an event ID with different content, or a new callback after a final outcome, returns `409`. Invalid payloads return `400`; missing, stale, or wrong signatures return `401`; missing server configuration returns `503`; unknown campaign returns `404`.

## Timeout and approval handling

Pending approval is an interim Node response, not a final campaign outcome. Node must not callback `completed` until delivery actually finishes. An uncertain request timeout leaves the campaign pending with the reservation held. There is no automatic refund or resend. An operator must verify the send outcome from reliable Node/WhatsApp evidence before arranging a definitive callback. The repository does not yet define an admin reconciliation UI or a Node dispatch idempotency mechanism; these remain deployment work before uncertain outcomes can be resolved safely at scale.

## DP campaign gap

`WappDpCampaign.jsx` posts `message`, `visit_url`, `call_number`, media/results, `total`, and `user_id` to `/api/update-dp/`. That endpoint is absent from current `api/urls.py`, and the repository history has no Django `update_dp` view or route. Migration `0014` added `Campaign.visit_url` and `Campaign.call_number`, but no code in Django reads/writes these fields, and the historical `/send-bulk` route did not use `visitUrl` or `callNumber`. The current Node route and the live deployment contract are unavailable. The exact campaign persistence, credit, button-rendering, and reporting rules cannot be established from the source; no `/api/update-dp/` endpoint was invented.

## Production requirements

- Add `CAMPAIGN_CALLBACK_SECRET` to Django and the actual Node service, with a strong random value.
- Identify the deployed Node service and its real sender before implementing a bulk route. The checked-in `backend/server.js` provides only `/send-single`; it needs a `deviceId`, sends text only, and the React bulk form currently supplies neither a device ID nor a documented user-to-device mapping. Do not wrap it speculatively. Once the actual sender contract is verified, configure a server-only callback URL (proposed name: `CAMPAIGN_CALLBACK_URL`) and implement signed callbacks for actual final outcomes, including later approval completion.
- Verify callback delivery/retry behavior and end-to-end status handling against a staging sender before enabling it in production. Do not test with real recipients until separately approved.
- Define a trusted operational path for reviewing indefinitely pending/unknown reservations and confirm the actual approval policy. Do not reuse the historical simulated auto-completion behavior as delivery evidence.
- Resolve the missing DP backend contract before enabling the DP campaign screen.
