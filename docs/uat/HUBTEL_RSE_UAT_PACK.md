# Hubtel RSE UAT Pack (Unilove Restaurant)

Prepared on: 2026-02-25
Environment: Production (`https://unilove.iderwell.com`)

## Requirement Mapping

| # | Hubtel RSE Requirement | Delivered Artifact |
|---|---|---|
| 1 | Meeting to test services from end-user perspective | `docs/uat/UAT_END_USER_MEETING_RUNBOOK.md` |
| 2 | Sample callbacks received from Hubtel for all APIs | `docs/uat/samples/*.json` |
| 3 | Sample transaction status check response | `docs/uat/samples/transaction-status-check-response.json` |
| 4 | Link to app when live | `docs/uat/LIVE_LINKS.md` |
| 5 | Predesigned API interface flow (PPT/PDF) | `docs/uat/Hubtel_API_Interface_Flow.pdf` |

## Callback Samples Included

1. Programmable Services payment callback (Paid):
   - `docs/uat/samples/callback-programmable-services-paid.json`
2. Receive Money callback (Paid):
   - `docs/uat/samples/callback-receive-money-paid.json`
3. Receive Money callback (Failed):
   - `docs/uat/samples/callback-receive-money-failed.json`
4. Programmable USSD interaction requests Hubtel sends to app:
   - `docs/uat/samples/interaction-ussd-initiation.json`
   - `docs/uat/samples/interaction-ussd-response.json`
   - `docs/uat/samples/interaction-ussd-timeout.json`

Notes:
- Payment callback samples are extracted from persisted production callback payloads (`payments.raw_payload`) with metadata timestamps. Per stakeholder direction, this UAT pack uses real unmasked production data.
- Signature header key expected by the app is `x-hubtel-signature`. Real signature values are included in each callback sample in both raw-hex (`headers`) and prefixed (`headersSha256Prefixed` => `sha256=<hex>`) formats. They are generated with the live `HUBTEL_CALLBACK_SECRET` over the canonical callback body bytes (`JSON.stringify(body)`).

## Transaction Status Check Sample

- File: `docs/uat/samples/transaction-status-check-response.json`
- Source: real status-check call using configured Hubtel status-check credentials.
- Example result in sample: `responseCode: "0000"`, `status: "Paid"`.

## Submission Checklist

- [ ] Share all files in `docs/uat/` with Hubtel RSE.
- [ ] Align on UAT meeting slot using `UAT_END_USER_MEETING_RUNBOOK.md`.
- [ ] Use live URLs in `LIVE_LINKS.md` during session.
- [ ] Validate signatures and callbacks during test run.

