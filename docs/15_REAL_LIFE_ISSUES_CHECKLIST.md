# Real-Life Operations Issues Checklist

This checklist tracks whether each real-life issue is already covered in code, partially covered, or still pending.

Status legend:
- `DONE`: Implemented and visible in current workflow.
- `PARTIAL`: Some support exists, but needs stronger controls/UI/reporting.
- `PENDING`: Not yet implemented.

| # | Issue | Status | Current Handling / Gap |
|---|---|---|---|
| 1 | Wrong order entered by staff | DONE | Cancel flow with reason in order detail + audit log. |
| 2 | Customer changes mind after payment | PARTIAL | Cancel + refund path exists; policy playbook and SLA automation pending. |
| 3 | Payment succeeds but callback delayed | PARTIAL | Reconciliation endpoint exists; automatic exception alerting can be improved. |
| 4 | Payment prompt fails repeatedly | PARTIAL | Payment failure status exists; retry policy/UX guidance pending. |
| 5 | Kitchen stock-out after order | DONE | Cancel reasons include item unavailable + kitchen unable to fulfill. |
| 6 | Excessive prep delay | PARTIAL | Delayed KPI exists; SLA breach notifications still pending. |
| 7 | Delivery rider cannot reach customer | PARTIAL | Returned flow exists; structured failed-attempt capture pending. |
| 8 | Invalid customer phone number | PARTIAL | Validation and SMS logging exist; proactive phone verification onboarding pending. |
| 9 | Fraudulent order behavior | PARTIAL | Fraud reason exists; automated risk scoring/blacklist pending. |
| 10 | Duplicate order placement | DONE | Cancel reason supports duplicates + full audit trail. |
| 11 | USSD menu too long/truncated | PARTIAL | USSD service present; pagination hardening and copy optimization still needed. |
| 12 | Customer disputes charged amount | DONE | Disputes module added with statuses, owner trail, and resolution logging. |
| 13 | Order prepared but never picked up | PARTIAL | Status flow supports tracking; auto timeout + reclaim policy pending. |
| 14 | Network outage at store | PARTIAL | Offline in-store queue/sync exists with encrypted local storage; conflict handling policy still pending. |
| 15 | Store closed but orders still coming | DONE | Global store-open/close mode now blocks new online, USSD, and in-store orders. |
| 16 | Staff performs unauthorized actions | DONE | Action-level permission matrix enforced in API + staff permission editor. |
| 17 | Admin account compromise attempt | PARTIAL | Login rate limit + security logs exist; MFA/IP policy pending. |
| 18 | Missing audit trail during incident review | DONE | Security, SMS, money, and error logs with pagination are available. |
| 19 | Customer not notified after key order event | PARTIAL | SMS on major transitions exists; per-event template control pending. |
| 20 | Receipt link not delivered | PARTIAL | Receipt URL is attached in paid SMS; delivery failure fallback pending. |
| 21 | Refund backlog not visible to ops | DONE | Dedicated Refund Queue lane added to operations board. |
| 22 | Paid cancellations mixed with unpaid cancellations | DONE | Paid cancellations now routed to Refund Queue; unpaid stay in Canceled lane. |
| 23 | Menu management too cluttered | PARTIAL | Category management exists; further UX grouping polish ongoing. |
| 24 | In-store cart not visually distinct | PARTIAL | Improved styling added; further UX refinements still possible. |
| 25 | Past customer lookup is slow | DONE | Phone suggestions + autofill via customer search endpoint. |
| 26 | Log pages too long to use | DONE | Bottom pagination + page numbers + jump-to-page implemented. |
| 27 | Analytics not actionable for restaurant ops | PARTIAL | Expanded KPIs + SLA health dashboard added; predictive staffing/inventory KPIs pending. |
| 28 | Too many requests blocks admin workflow | PARTIAL | Rate limits configurable; workflow-specific limiter tuning and exemptions pending. |
| 29 | No clear policy for cancel/refund eligibility | DONE | Centralized order policy service + validated reasons + refund eligibility rules. |
| 30 | Post-incident learning not captured | PARTIAL | Incident runbook page now exists; structured retrospective templates still pending. |

## Immediate next build targets
1. Incident retrospective template (root cause, blast radius, prevention tasks).
2. Automated dispute SLA and escalation rules.
3. Predictive staffing and inventory recommendations from analytics trends.
4. Rate-limit policy tuning per endpoint/user class.
5. Offline queue privacy hardening and conflict-resolution policy for resync.
