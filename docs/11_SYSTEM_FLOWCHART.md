# System Flowchart (Current Implementation)

Last verified against code: 2026-02-12

## 1) End-to-End Architecture

```mermaid
flowchart LR
    Customer[Customer Channels\nOnline / USSD / In-Store] --> PublicAPI[/Public API/]
    PublicAPI --> OrderService[Order Service]
    OrderService --> DB[(SQLite)]

    Hubtel[Hubtel Callback] --> Sig[Signature Verification]
    Sig --> PaymentService[Payment Service]
    PaymentService --> OrderService

    OrderService --> Loyalty[Loyalty Service]
    OrderService --> Receipt[Receipt Service]
    OrderService --> SMS[SMS Service]

    Receipt --> ReceiptHost[/receipts/*/]
    Loyalty --> DB
    SMS --> DB

    AdminUI[Admin UI] --> AdminAPI[/Admin API/]
    AdminAPI --> OrderService
    AdminAPI --> Analytics[Analytics Service]
    Analytics --> DB

    RiderUI[Rider UI] --> RiderQueue[/GET api/rider/queue/]
    RiderUI --> Verify[/POST api/delivery/verify/]
    Verify --> OrderService
```

## 2) Operations Board Flow

```mermaid
flowchart TD
    Paid[Order becomes PAID] --> Incoming[Incoming Orders Lane]
    Incoming --> Check{Monitored?}
    Check -->|No| Alert[High-pitch alert loop]
    Check -->|Yes| Stop[Alert stops for that order]

    Incoming --> StartProcessing[Start Processing]
    StartProcessing --> Kitchen[Kitchen Queue]
    Kitchen --> Type{Delivery Type}

    Type -->|Pickup| ReadyPickup[Ready For Pickup]
    ReadyPickup --> PickupComplete[Mark Completed]

    Type -->|Delivery| Dispatch[Out For Delivery]
    Dispatch --> VerifyCode[Delivery Code Verification]
    VerifyCode --> Delivered[Delivered]

    Dispatch --> Returned[Returned Exception]
    Returned --> Refunded[Refunded]
```

## 3) Security Control Points

```mermaid
flowchart LR
    Req[HTTP Request] --> Helmet[Helmet]
    Helmet --> RateLimit[Rate Limit]
    RateLimit --> Validate[Input Validation]
    Validate --> Controller[Controller]
    Controller --> Service[Service Layer]
    Service --> Repo[Repository]
    Repo --> DB[(SQLite)]

    Callback[Hubtel Callback] --> VerifySig[Verify Signature]
    VerifySig --> Controller

    AdminMut[Admin Mutating Call] --> Auth[JWT Cookie Auth]
    Auth --> Csrf[CSRF Validation]
    Csrf --> Controller

    Service --> Audit[Audit Log]
    Audit --> DB
```

## 4) Surface Map

- Admin: `/admin/*`
- Rider: `/rider/index.html`
- Receipts: `/receipts/*`
- APIs: `/api/*` and `/api/admin/*`
