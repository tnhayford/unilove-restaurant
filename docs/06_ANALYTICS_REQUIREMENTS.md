# Analytics Requirements (Current Baseline)

Last verified against code: 2026-02-12

## Data Source

Analytics values are SQL-derived from transactional tables. No hardcoded KPI values.

## Implemented KPI Set

Revenue and sales:

- Daily revenue
- Monthly revenue
- Top 10 selling items
- Average order value

Delivery and loyalty:

- Delivery success rate
- Loyalty issued per day

Operational breakdowns:

- Status breakdown
- Source breakdown
- Pending payment count
- Preparing count
- Payment issue count
- Completed today count
- Delayed count (>30 minutes)

## Filter Support

`GET /api/admin/analytics` supports:

- `startDate` (`YYYY-MM-DD`)
- `endDate` (`YYYY-MM-DD`)
- `source` (`online`, `ussd`, `instore`)
- `deliveryType` (`pickup`, `delivery`)

## Calculation Notes

- Revenue calculations include paid-like records and exclude refunded states according to repository queries.
- Delivery success rate is computed on delivery orders only.
- Delayed count excludes terminal states.

## UX Baseline

Analytics page shows:

- KPI cards
- Revenue bars (daily/monthly)
- Loyalty bars
- Top items table
- Status/source breakdown tables
- Filter controls and refresh action

## Rule

Any new analytics metric must be SQL-backed and filter-aware.
