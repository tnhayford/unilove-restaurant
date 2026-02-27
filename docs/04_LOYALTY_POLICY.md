# Loyalty Policy (Current Implementation)

Last verified against code: 2026-02-12

## Formula

`floor(order_total / 35) * 5`

## Issuance Rules

- Loyalty points are awarded only when an order reaches `PAID`.
- If points were already issued for an order, duplicate issuance is blocked.
- Orders below threshold award zero points.
- `REFUNDED` and `RETURNED` orders are not eligible to retain issued points.

## Reversal Rules

- Moving an order to `RETURNED` or `REFUNDED` reverses previously issued points.
- Reversal is stored as a negative loyalty ledger entry.

## Data Persistence

- Ledger table stores each issue/reversal event.
- Order record stores `loyalty_points_issued` snapshot.

## UI/Receipt Exposure

- Order detail page shows points earned on that order and customer accumulated total.
- Receipt includes loyalty earned and loyalty total.
- Analytics includes loyalty issued per day.

## Out of Scope

- Point redemption
- Voucher conversion
- Tiering/multipliers
