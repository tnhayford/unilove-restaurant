# UAT Meeting Runbook (End-User Perspective)

Prepared for: Hubtel RSE + Unilove Team  
Date reference: 2026-02-25

## 1. Session Objective

Validate the full customer journey and payment lifecycle exactly as an end user experiences it, including asynchronous callbacks from Hubtel and fallback status-check behavior.

## 2. Participants

- Hubtel RSE
- Unilove Product/Operations Owner
- Unilove Technical Owner
- QA Observer / Minute taker

## 3. Proposed Duration

- 60 minutes total

## 4. Test Journeys (End-user first)

### Journey A: USSD customer places and pays order

1. Customer dials `*713*8575#`.
2. Customer browses menu, adds item(s), checks out.
3. Hubtel payment prompt appears on phone.
4. Customer approves payment (MoMo PIN).
5. Hubtel callback lands on `POST /api/payments/hubtel/callback`.
6. Order status updates to paid/preparing on operations side.

Expected pass criteria:
- USSD navigation remains within screen limits (no critical truncation of control options).
- Payment callback accepted and order status updated.
- No leakage of other customer order data.

### Journey B: In-store MoMo prompt + callback

1. Staff creates in-store order with MoMo payment.
2. Prompt sent via Hubtel Receive Money.
3. Customer approves or declines.
4. Callback received (paid/failed path both tested).

Expected pass criteria:
- Paid callback transitions order to valid next state.
- Failed callback transitions to `PAYMENT_FAILED` when still pending payment.

### Journey C: Callback delay fallback (status check)

1. Choose a known `clientReference`.
2. Run status check via admin payment reconcile route.
3. Validate returned Hubtel status and reconciliation behavior.

Expected pass criteria:
- Status check call returns valid payload.
- Reconciliation can update payment state when callback is delayed/missing.

## 5. APIs to Exercise During UAT

- Hubtel -> Unilove:
  - `POST /api/ussd/interaction`
  - `POST /api/payments/hubtel/callback`
- Unilove -> Hubtel:
  - Receive Money API
  - Transaction Status Check API

## 6. Evidence to Capture During Session

- Timestamped screen recording of customer path.
- Callback payload + app response pair.
- Order state before and after callback.
- Status-check response payload.

## 7. Exit Criteria

- All critical paths pass without blocking defects.
- Callback signature verification behavior validated.
- UAT sign-off notes captured from Hubtel RSE.

